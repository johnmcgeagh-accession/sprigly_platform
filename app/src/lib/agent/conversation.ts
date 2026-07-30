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
import type { InterpretedItem } from './types';

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
    return {
      id: r.id,
      role: (r.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: r.content,
      source: (r.source === 'voice' ? 'voice' : 'web') as 'web' | 'voice',
      createdAt: r.createdAt.toISOString(),
      ...(items ? { items } : {}),
      ...(meta['changeSetId'] !== undefined ? { changeSetId: (meta['changeSetId'] as string | null) } : {}),
      ...(proposalIds ? { proposalIds } : {}),
    };
  });
}

/**
 * The thread as the PARSER reads it — a bounded window of recent turns, compact text. An
 * assistant turn that carried an interpretation is serialised from its RESOLVED items (title +
 * ISO dates), because "move it back" resolves against what actually happened, not against
 * "Proposed 1 change for review." — the prose fallback says nothing a reference can grip.
 */
export function threadForParser(turns: readonly ConversationTurn[], maxTurns = 12): string {
  const recent = turns.slice(-maxTurns);
  if (!recent.length) return '';
  const lineOf = (i: InterpretedItem): string => {
    if (i.kind === 'idea') return `saved idea: "${i.text}"`;
    if (i.kind === 'unresolved') return `could not do: ${i.question}`;
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
