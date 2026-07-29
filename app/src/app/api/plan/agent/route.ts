/**
 * POST /api/plan/agent — the task-parser-based plan agent.
 *
 * Auth + rate-limit + body parsing only; the parse → execute → persist core lives in
 * lib/agent/turn.ts (runPlanAgentTurn), shared with the intake route's post-cutoff branch.
 * Every message goes through the LLM task parser: move/delete/rewrite/add → pending
 * PROPOSALS (nothing applies here); add_note → a direct plan_inputs write; query → inline
 * answer; clarify → surfaced.
 *
 * SCOPE. The client is the CLIENT of the session token; the CYCLE is the month they are looking
 * at. The two are not the same thing: a magic link is issued for one cycle, but the surface lets
 * the client browse every month they have, and the agent has to follow them there. It used to
 * take `session.cycleId` — so a client standing on August was answered about whichever month
 * their link happened to name, which is how it came to say "I can only edit posts in the current
 * September 2026 cycle" to someone with August on screen. The viewed cycle is now sent with the
 * message and verified to belong to this client before it is used; anything unrecognised falls
 * back to the session's own cycle rather than failing the turn.
 *
 * Response: { conversationId, message, proposals[], changeSetId }.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { allowRequest } from '@/lib/rate-limit';
import { runPlanAgentTurn } from '@/lib/agent/turn';
import { cycleBelongsToClient } from '@/lib/agent/cycle-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const { clientId, cycleId } = session;

  // Interim per-share-link rate limit (see design/DECISIONS.md). Keyed by the token's scope.
  if (!allowRequest(`agent:${clientId}:${cycleId}`)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let instruction = '';
  let conversationId: string | undefined;
  let source: 'web' | 'voice' = 'web';
  let voiceSessionId: string | undefined;
  let viewedCycleId: string | undefined;
  try {
    const b = (await req.json()) as { instruction?: unknown; conversationId?: unknown; source?: unknown; sessionId?: unknown; cycleId?: unknown };
    instruction = String(b.instruction ?? '').trim();
    if (b.conversationId) conversationId = String(b.conversationId);
    if (b.source === 'voice') source = 'voice';
    if (b.sessionId) voiceSessionId = String(b.sessionId);
    if (b.cycleId) viewedCycleId = String(b.cycleId);
  } catch { /* handled below */ }
  if (!instruction) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // The viewed cycle comes from the browser, so it is checked, not trusted — a client may only
  // ever be answered about their own months.
  const turnCycleId =
    viewedCycleId && viewedCycleId !== cycleId && (await cycleBelongsToClient(clientId, viewedCycleId))
      ? viewedCycleId
      : cycleId;

  const resp = await runPlanAgentTurn({ clientId, cycleId: turnCycleId, instruction, source, sessionId: voiceSessionId, conversationId });
  return NextResponse.json(resp);
}
