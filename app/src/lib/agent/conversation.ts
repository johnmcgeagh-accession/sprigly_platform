/**
 * agent/conversation.ts — conversation + message persistence.
 *
 * A conversation groups a client's messages with the agent's replies. All access is scoped to
 * the session's clientId — a forged conversationId belonging to another client is never reused
 * (the cycle's own conversation, or a fresh one, is used instead).
 *
 * ── ONE CONVERSATION PER SESSION (operator ruling, round 2) ──────────────────────────
 *
 * Round 1 made the thread per-CYCLE and everlasting: reopening the sheet showed every exchange
 * the month had ever had. The ruling reverses it. Each sheet open is a fresh conversation,
 * opening on the framing copy; the prior ones stay stored and simply are not rendered.
 *
 * Two reasons this is the better shape, and neither is about storage. A month's chat accumulates
 * for as long as the month exists, so the client arrives at a wall of history they have to scroll
 * past to say one sentence — and the CONTEXT WINDOW is the same list, so a stale reference from
 * three weeks ago competes with the thing they just said. A session is the unit the client
 * actually thinks in: "the conversation I am having now".
 *
 * Nothing is deleted. `agent_messages` keeps every turn under its own conversation row, so the
 * record is intact for anyone who needs it later; what changes is which one the sheet asks for.
 * The storage is still the smallest honest one — the tables (migration 0062) already carry role,
 * source, timestamps and a metadata blob per message.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, conversations, agentMessages } from '@sprigly/db';
import type { InterpretedItem, PendingIntent } from './types';

/**
 * Start a conversation for this cycle and return its id. One per sheet open — the SESSION is
 * the unit, so this is called by the sheet on open rather than inferred from what exists.
 */
export async function startConversation(clientId: string, cycleId: string | null): Promise<string> {
  const [created] = await db
    .insert(conversations)
    .values({ clientId, cycleId })
    .returning({ id: conversations.id });
  return created!.id;
}

/**
 * Return an owned conversation id: the one passed (if it is this client's), else a NEW one.
 *
 * A turn that arrives with no conversationId no longer adopts the cycle's most recent thread —
 * that was the per-cycle model, and it is what made a reopened sheet show a month's worth of
 * history. Without an id, this turn is the start of a session.
 */
export async function ensureConversation(
  clientId: string,
  cycleId: string | null,
  conversationId?: string,
): Promise<string> {
  if (conversationId) {
    const [row] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.clientId, clientId)))
      .limit(1);
    if (row) return row.id;
  }
  return startConversation(clientId, cycleId);
}

export interface AppendMessageArgs {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  source?: 'web' | 'voice';
  metadata?: Record<string, unknown>;
}

/**
 * One turn of the thread, as the sheet renders it. `items` is the interpretation the assistant
 * turn carried (stored in message metadata at turn time — the resolved titles and dates, never
 * re-derived); `changeSetId`/`proposalIds` let the sheet cross-check which changes are still
 * pending so a reopened interpretation turn stays actionable only while its proposals are.
 */
export interface ConversationTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  source: 'web' | 'voice';
  createdAt: string;
  items?: InterpretedItem[];
  changeSetId?: string | null;
  proposalIds?: string[];
  /** The change this turn was still ASSEMBLING when it asked its question (G1). Stored on the
   *  message rather than on the conversation: an intent belongs to the turn that asked, so a
   *  turn that resolves it simply carries none, and no row needs clearing. */
  pendingIntent?: PendingIntent | null;
}

/** The most recent `limit` turns of a conversation, oldest first. Ownership is enforced by the
 *  join — a conversation id that isn't this client's returns nothing. */
export async function listTurns(clientId: string, conversationId: string, limit = 60): Promise<ConversationTurn[]> {
  const rows = await db
    .select({
      id: agentMessages.id, role: agentMessages.role, content: agentMessages.content,
      source: agentMessages.source, createdAt: agentMessages.createdAt, metadata: agentMessages.metadata,
    })
    .from(agentMessages)
    .innerJoin(conversations, eq(agentMessages.conversationId, conversations.id))
    .where(and(eq(agentMessages.conversationId, conversationId), eq(conversations.clientId, clientId)))
    .orderBy(desc(agentMessages.createdAt))
    .limit(limit);
  return rows.reverse().map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const items = Array.isArray(meta['items']) ? (meta['items'] as InterpretedItem[]) : undefined;
    const proposalIds = Array.isArray(meta['proposalIds']) ? (meta['proposalIds'] as string[]) : undefined;
    const pi = meta['pendingIntent'];
    const pendingIntent = pi && typeof pi === 'object' ? (pi as PendingIntent) : undefined;
    return {
      id: r.id,
      role: (r.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: r.content,
      source: (r.source === 'voice' ? 'voice' : 'web') as 'web' | 'voice',
      createdAt: r.createdAt.toISOString(),
      ...(items ? { items } : {}),
      ...(meta['changeSetId'] !== undefined ? { changeSetId: (meta['changeSetId'] as string | null) } : {}),
      ...(proposalIds ? { proposalIds } : {}),
      ...(pendingIntent ? { pendingIntent } : {}),
    };
  });
}

/**
 * The thread as the PARSER reads it — a bounded window of recent turns, compact text. An
 * assistant turn that carried an interpretation is serialised from its RESOLVED items (title +
 * ISO dates), because "move it back" resolves against what actually happened, not against
 * "Proposed 1 change for review." — the prose fallback says nothing a reference can grip.
 *
 * ── A QUESTION IS NOT A FAILURE (G1) ─────────────────────────────────────────────────
 *
 * An `unresolved` item used to serialise as `could not do: <question>`. The question text was
 * there — the raspberry thread's "Is it new, or an existing one coming back?" reached the
 * parser verbatim — but it arrived under a label that says the ask was DROPPED. Nothing in
 * that line tells a model that a reply is outstanding, so the next utterance had nothing to be
 * an answer TO, and "Reels" could only be read as a fresh, verbless request.
 *
 * `unresolved` carries two different states and the label now distinguishes them: a genuine
 * dead end (`could not do:`) and an open question (`asked:`). A question is one that ends in a
 * question mark — which is what the thing itself is, rather than a flag someone has to
 * remember to set.
 */
export function threadForParser(turns: readonly ConversationTurn[], maxTurns = 12): string {
  const recent = turns.slice(-maxTurns);
  if (!recent.length) return '';
  const lineOf = (i: InterpretedItem): string => {
    if (i.kind === 'idea') return `saved idea: "${i.text}"`;
    if (i.kind === 'unresolved') {
      return /\?\s*$/.test(i.question) ? `asked: "${i.question}"` : `could not do: ${i.question}`;
    }
    const dates = [i.fromDate, i.toDate].filter(Boolean).join(' → ');
    return `${i.action} "${i.title ?? 'post'}"${dates ? ` ${dates}` : ''}${i.format ? ` (${i.format})` : ''}`;
  };
  return recent
    .map((t) => {
      if (t.role === 'user') return `CLIENT: ${t.content}`;
      const body = t.items?.length ? t.items.map(lineOf).join('; ') : t.content;
      return `ASSISTANT: ${body}`;
    })
    .filter((l) => l.length > 'ASSISTANT: '.length)
    .join('\n');
}

/**
 * The intent still being assembled, if any — the last assistant turn's, and only the LAST.
 *
 * An intent belongs to the turn that asked for the missing slot. If the turn after it carried
 * none, the assembly either resolved or the client walked away from it, and either way there is
 * nothing left to merge an answer into. Reaching further back would resurrect an ask the
 * conversation has already moved past, which is the wall-of-history failure the per-session
 * ruling exists to prevent, in miniature.
 */
export function latestPendingIntent(turns: readonly ConversationTurn[]): PendingIntent | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (t.role !== 'assistant') continue;
    return t.pendingIntent ?? null;
  }
  return null;
}

/** The intent, as the parser reads it: the slots that are filled, the ones that are not, and
 *  the question the last turn asked. Empty string when nothing is being assembled. */
export function intentForParser(intent: PendingIntent | null | undefined): string {
  if (!intent) return '';
  const s = intent.slots ?? {};
  const line = (name: string, v: unknown) =>
    `- ${name}: ${v === null || v === undefined || v === '' ? '(not yet said)' : String(v)}`;
  const asked = intent.asked?.length ? `\nALREADY ASKED ABOUT: ${intent.asked.join(', ')} — do not ask about these again.` : '';
  return [
    `A ${intent.action} is being assembled across turns. What is known so far:`,
    line('subject', s.subject),
    line('angle', s.angle),
    line('format', s.format),
    line('count', s.count),
    line('date', s.date),
    intent.question ? `YOUR LAST TURN ASKED: "${intent.question}"` : '',
    asked,
  ].filter(Boolean).join('\n');
}

/** Append a message and bump the conversation's last_message_at. Returns the id. */
export async function appendMessage(args: AppendMessageArgs): Promise<string> {
  const [created] = await db
    .insert(agentMessages)
    .values({
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      source: args.source ?? 'web',
      ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
    })
    .returning({ id: agentMessages.id });
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, args.conversationId));
  return created!.id;
}
