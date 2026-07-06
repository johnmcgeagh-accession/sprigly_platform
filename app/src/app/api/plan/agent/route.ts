/**
 * POST /api/plan/agent — the proposal-based plan agent (commit 2).
 *
 * Persists the turn (user + assistant messages) to a conversation and routes the
 * message:
 *   - Typed input tries the deterministic regex classifier first (free, instant).
 *   - Voice input, and any unconfident typed input, goes to the LLM router (Haiku).
 *   - structural / add / rewrite → the EXISTING mutation + shape-job pipeline.
 *   - note_for_month / idea_backlog / next_cycle_input → a pending proposal (no
 *     content table is touched until the client approves it).
 *   - query → a grounded answer (knowledge retrieval + current cycle state).
 *   - clarify → a gentle nudge.
 * Response: { conversationId, message, proposals[], applied?, pendingJobIds? }.
 * Everything is scoped server-side to the session's (clientId, cycleId).
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { loadPlanPosts } from '@/lib/plan';
import { classifyAgentInstruction } from '@/lib/agent-classify';
import { runActionPlan } from '@/lib/agent/actions';
import { runLlmRouter } from '@/lib/agent/router';
import { getClientCycleMonths, resolveCycleForMonth } from '@/lib/agent/cycle-state';
import { getModelClient, getEmbeddingClient } from '@/lib/agent/model';
import { ensureConversation, appendMessage } from '@/lib/agent/conversation';
import { buildCapture } from '@/lib/agent/capture';
import { createProposal } from '@/lib/agent/proposals';
import { answerQuery } from '@/lib/agent/query';
import { CAPTURE_INTENTS, type AgentTurnResponse, type CaptureIntent, type ProposalView, type RouterResult } from '@/lib/agent/types';
import type { AgentPlan } from '@/lib/agent-classify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const isCapture = (i: string): i is CaptureIntent => (CAPTURE_INTENTS as readonly string[]).includes(i);

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const { clientId, cycleId } = session;

  let instruction = '';
  let selectedPostId: string | undefined;
  let conversationId: string | undefined;
  let source: 'web' | 'voice' = 'web';
  let voiceSessionId: string | undefined;
  try {
    const b = (await req.json()) as {
      instruction?: unknown; selectedPostId?: unknown; conversationId?: unknown; source?: unknown; sessionId?: unknown;
    };
    instruction = String(b.instruction ?? '').trim();
    if (b.selectedPostId) selectedPostId = String(b.selectedPostId);
    if (b.conversationId) conversationId = String(b.conversationId);
    if (b.source === 'voice') source = 'voice';
    if (b.sessionId) voiceSessionId = String(b.sessionId);
  } catch { /* handled below */ }
  if (!instruction) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Persist the turn's user message.
  const convId = await ensureConversation(clientId, cycleId, conversationId);
  const userMetadata: Record<string, unknown> = {};
  if (voiceSessionId) userMetadata.sessionId = voiceSessionId;
  const userMessageId = await appendMessage({
    conversationId: convId, role: 'user', content: instruction, source,
    ...(Object.keys(userMetadata).length ? { metadata: userMetadata } : {}),
  });

  const posts = await loadPlanPosts(clientId, cycleId);

  // ── Route ────────────────────────────────────────────────────────────────
  let plan: AgentPlan | null = null;
  let routed: RouterResult | null = null;

  if (source === 'web') {
    const fast = classifyAgentInstruction(instruction, posts, selectedPostId);
    if (fast.kind !== 'clarify') plan = fast;
  }
  if (!plan) {
    try {
      const cycleMonths = await getClientCycleMonths(clientId, cycleId);
      routed = await runLlmRouter(instruction, { today: todayIso(), cycleMonths }, getModelClient());
      // An LLM-classified action is re-resolved deterministically so it runs through
      // the exact existing pipeline; if the cleaned text still can't resolve a target,
      // fall back to the router's clarify text.
      if (routed.intent === 'structural' || routed.intent === 'add' || routed.intent === 'rewrite') {
        const rePlan = classifyAgentInstruction(routed.content, posts, selectedPostId);
        if (rePlan.kind !== 'clarify') plan = rePlan;
      }
    } catch {
      // Router/model unavailable (e.g. Bedrock env not configured) — degrade to a
      // clarify rather than 500 the turn. The message is still persisted.
      routed = { intent: 'clarify', content: 'I couldn’t process that just now — please try again in a moment.', targetMonth: null, channel: null };
    }
  }

  // ── Handle ───────────────────────────────────────────────────────────────
  const proposals: ProposalView[] = [];
  const resp: AgentTurnResponse = { conversationId: convId, message: '', proposals };
  let assistantIntent = 'clarify';

  if (plan) {
    assistantIntent = plan.kind;
    const outcome = await runActionPlan(plan, clientId, cycleId);
    resp.message = outcome.text;
    if (outcome.applied) resp.applied = outcome.applied;
    if (outcome.pendingJobIds) resp.pendingJobIds = outcome.pendingJobIds;
  } else if (routed) {
    assistantIntent = routed.intent;
    if (routed.intent === 'query') {
      try {
        resp.message = await answerQuery(
          { clientId, cycleId, question: routed.content, today: new Date() },
          { model: getModelClient(), embeddingClient: getEmbeddingClient() },
        );
      } catch {
        resp.message = 'I couldn’t look that up just now — please try again.';
      }
    } else if (isCapture(routed.intent)) {
      // note_for_month defaults to the current cycle when no month is named.
      const resolvedCycle = routed.targetMonth
        ? await resolveCycleForMonth(clientId, routed.targetMonth)
        : routed.intent === 'note_for_month' ? cycleId : null;
      const cap = buildCapture(routed.intent, routed, resolvedCycle);
      const pv = await createProposal({
        clientId, conversationId: convId, messageId: userMessageId,
        intent: cap.intent, payload: cap.payload, summary: cap.summary,
      });
      proposals.push(pv);
      resp.message = `Got it — ${cap.summary}. Approve it and I’ll add it to your plan inputs.`;
    } else {
      // clarify (or an action intent whose target couldn't be resolved)
      resp.message = routed.content || 'Could you say a bit more about what you’d like to change?';
    }
  } else {
    resp.message = 'Could you say a bit more about what you’d like to change?';
  }

  // Persist the assistant reply.
  await appendMessage({
    conversationId: convId, role: 'assistant', content: resp.message,
    metadata: { intent: assistantIntent, proposalIds: proposals.map((p) => p.id) },
  });

  return NextResponse.json(resp);
}
