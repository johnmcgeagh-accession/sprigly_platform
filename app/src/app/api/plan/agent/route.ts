/**
 * POST /api/plan/agent — the task-parser-based plan agent.
 *
 * Auth + rate-limit + body parsing only; the parse → execute → persist core lives in
 * lib/agent/turn.ts (runPlanAgentTurn), shared with the intake route's post-cutoff branch.
 * Every message goes through the LLM task parser: move/delete/rewrite/add → pending
 * PROPOSALS (nothing applies here); add_note → a direct plan_inputs write; query → inline
 * answer; clarify → surfaced. Scoped server-side to the session's (clientId, cycleId).
 * Response: { conversationId, message, proposals[], changeSetId }.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { allowRequest } from '@/lib/rate-limit';
import { runPlanAgentTurn } from '@/lib/agent/turn';

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
  try {
    const b = (await req.json()) as { instruction?: unknown; conversationId?: unknown; source?: unknown; sessionId?: unknown };
    instruction = String(b.instruction ?? '').trim();
    if (b.conversationId) conversationId = String(b.conversationId);
    if (b.source === 'voice') source = 'voice';
    if (b.sessionId) voiceSessionId = String(b.sessionId);
  } catch { /* handled below */ }
  if (!instruction) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const resp = await runPlanAgentTurn({ clientId, cycleId, instruction, source, sessionId: voiceSessionId, conversationId });
  return NextResponse.json(resp);
}
