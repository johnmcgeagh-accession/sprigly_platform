/**
 * POST /api/plan/conversation/confirm — the apply's settled report, as a turn.
 *
 * ── Two things this closes ───────────────────────────────────────────────────────────
 *
 * 1. THE CONFIRMATION WAS NEVER PERSISTED (carried since round 1). Apply is background work
 *    that runs in the browser, so the sentence it produces — "Done, your plan is updated", or
 *    the report of what didn't — existed only in React state. A remount inside the session lost
 *    it, and the parser never saw it at all.
 *
 * 2. THE RESCUE HAD NOTHING TO GRIP (G3). A refused change now says "Tell me another date and
 *    I'll put it in." That sentence is a promise, and it was unkeepable: the proposal is
 *    consumed, so the next utterance — "the 30th then" — had no referent anywhere. The refused
 *    change is written back as a PENDING INTENT (G1) on this turn, so the date lands in the
 *    slot it belongs to and the change is built again.
 *
 * ── What the client is allowed to say ────────────────────────────────────────────────
 *
 * The TEXT, and WHICH PROPOSALS. Never the intent: it is derived here from the proposal's own
 * stored payload, because an intent rides into the next turn's prompt and a client-supplied one
 * would be a way to write directly into it. The text is capped for the same reason it is
 * allowed at all — it was composed from server-derived items, and it is what the client already
 * has on screen.
 *
 * Only ONE refused change seeds an intent. The copy for several says "tell me another date and
 * I'll put them in", and there is no honest single slot for two different dates; those stay
 * named in the thread and re-asked in full.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, conversations } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { appendMessage } from '@/lib/agent/conversation';
import { loadProposalPayload } from '@/lib/agent/proposals';
import type { PendingIntent, ProposalPayload } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The confirmation is a sentence, not a document. */
const MAX_TEXT = 500;

/**
 * A refused change, as something still buildable.
 *
 * The subject comes from the proposal's own `instruction` (what the client said the post was
 * about) and the date from its payload, so the intent describes the change that was refused
 * rather than a fresh guess at one. `date` is deliberately carried even though it is the field
 * that failed: the next turn's prompt shows it as the value being replaced, which is what makes
 * "the 30th then" an amendment rather than a new request.
 */
function rescueIntent(payload: ProposalPayload, summary: string, question: string): PendingIntent | null {
  if (payload.kind === 'add') {
    return {
      action: 'add_post',
      slots: {
        subject: payload.instruction?.trim() || summary || null,
        date: payload.date,
        format: payload.format ?? null,
        count: 1,
        angle: null,
      },
      question,
      asked: ['date'],
    };
  }
  if (payload.kind === 'move') {
    return {
      action: 'move_post',
      slots: { subject: summary || null, date: payload.toDate, format: null, count: null, angle: null },
      question,
      asked: ['date'],
    };
  }
  // Everything else failed for a reason a date cannot fix (a quota, a read-only post, a thrown
  // job). The thread names it; there is no slot to offer.
  return null;
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let body: { conversationId?: unknown; text?: unknown; refusedProposalIds?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }); }

  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
  if (!conversationId || !text) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // The conversation id comes from the browser, so it is checked rather than trusted — the same
  // rule every other write path on this surface follows.
  const [owned] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.clientId, session.clientId)))
    .limit(1);
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const refused = Array.isArray(body.refusedProposalIds)
    ? body.refusedProposalIds.filter((v): v is string => typeof v === 'string' && !!v)
    : [];

  let pendingIntent: PendingIntent | null = null;
  if (refused.length === 1) {
    const row = await loadProposalPayload(session.clientId, refused[0]!);
    if (row) pendingIntent = rescueIntent(row.payload, row.summary, text);
  }

  await appendMessage({
    conversationId, role: 'assistant', content: text,
    metadata: { confirmation: true, ...(pendingIntent ? { pendingIntent } : {}) },
  });

  return NextResponse.json({ ok: true, rescue: !!pendingIntent });
}
