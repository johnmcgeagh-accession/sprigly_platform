/**
 * POST /api/plan/agent — the task-parser-based plan agent.
 *
 * EVERY message goes through the LLM task parser (no regex fast path). Tasks run in
 * message order:
 *   - move/delete/rewrite/add → pending PROPOSALS (nothing applies here). All
 *     proposals from one message share a changeSetId so they review as one unit.
 *   - add_note → a DIRECT write to plan_inputs (notes are inert until integrated).
 *   - query → answered inline (knowledge retrieval + cycle state).
 *   - clarify → surfaced in the reply.
 * The assistant reply summarises everything in message order.
 * Response: { conversationId, message, proposals[], changeSetId }.
 * Everything is scoped server-side to the session's (clientId, cycleId).
 */
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { loadPlanPosts } from '@/lib/plan';
import type { PlanPost } from '@/lib/types';
import { getModelClient, getEmbeddingClient } from '@/lib/agent/model';
import { parseTasks } from '@/lib/agent/task-parser';
import { getClientCycleMonths, resolveCycleForMonth, weekDigest } from '@/lib/agent/cycle-state';
import { resolvePostSelector } from '@/lib/agent/selectors';
import { moveSummary, deleteSummary, rewriteSummary, addSummary } from '@/lib/agent/summaries';
import { ensureConversation, appendMessage } from '@/lib/agent/conversation';
import { createProposal } from '@/lib/agent/proposals';
import { saveNote } from '@/lib/agent/notes';
import { answerQuery } from '@/lib/agent/query';
import type { AgentTurnResponse, ParsedTask, ProposalView } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const todayIso = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Resolve a task's post reference to an owned post, or null (ambiguous/hallucinated). */
function resolvePost(task: ParsedTask, posts: PlanPost[]): PlanPost | null {
  if (task.postId) {
    const byId = posts.find((p) => p.id === task.postId);
    if (byId) return byId;
  }
  if (task.selector) {
    const id = resolvePostSelector(task.selector, posts);
    if (id) return posts.find((p) => p.id === id) ?? null;
  }
  return null;
}

/** A sensible default date for an add_post with no date: two days after the last
 *  scheduled post, else a week out. */
function defaultAddDate(posts: PlanPost[], today: Date): string {
  const dates = posts.map((p) => p.date).sort();
  const base = dates.length ? new Date(`${dates[dates.length - 1]}T00:00:00`) : today;
  const d = new Date(base); d.setDate(d.getDate() + (dates.length ? 2 : 7));
  return todayIso(d);
}

const whichPost = (reason?: string | null) =>
  `I couldn’t tell which post you meant${reason ? ` for “${reason.trim()}”` : ''} — could you name its date?`;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const { clientId, cycleId } = session;

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

  const convId = await ensureConversation(clientId, cycleId, conversationId);
  const userMeta: Record<string, unknown> = { source };
  if (voiceSessionId) userMeta.sessionId = voiceSessionId;
  const userMessageId = await appendMessage({ conversationId: convId, role: 'user', content: instruction, source, metadata: userMeta });

  const posts = await loadPlanPosts(clientId, cycleId);
  const today = new Date();

  // ── Parse (the only entry point) ──────────────────────────────────────────
  let tasks: ParsedTask[];
  try {
    const ctx = {
      today: todayIso(today),
      cycleMonths: await getClientCycleMonths(clientId, cycleId),
      weekDigest: weekDigest(posts, today),
    };
    tasks = await parseTasks(instruction, ctx, getModelClient());
  } catch {
    tasks = [{ action: 'clarify', question: 'I couldn’t process that just now — please try again in a moment.' }];
  }

  // ── Execute in message order ──────────────────────────────────────────────
  const changeSetId = randomUUID();
  const proposals: ProposalView[] = [];
  const replyParts: string[] = [];

  const propose = async (action: 'move_post' | 'delete_post' | 'rewrite_post' | 'add_post', payload: Parameters<typeof createProposal>[0]['payload'], summary: string) => {
    const pv = await createProposal({ clientId, conversationId: convId, messageId: userMessageId, changeSetId, action, payload, summary });
    proposals.push(pv);
    replyParts.push(`• ${summary}`);
  };

  for (const task of tasks) {
    switch (task.action) {
      case 'move_post': {
        const post = resolvePost(task, posts);
        if (!post) { replyParts.push(whichPost(task.reason)); break; }
        if (!task.toDate) { replyParts.push(`Move “${post.caption?.split('\n')[0] || post.pillar}” to when?${task.reason ? ` (you asked: “${task.reason}”)` : ''}`); break; }
        await propose('move_post', { kind: 'move', cycleId, postId: post.id, toDate: task.toDate }, moveSummary(post, task.toDate, task.reason));
        break;
      }
      case 'delete_post': {
        const post = resolvePost(task, posts);
        if (!post) { replyParts.push(whichPost(task.reason)); break; }
        await propose('delete_post', { kind: 'delete', cycleId, postId: post.id }, deleteSummary(post, task.reason));
        break;
      }
      case 'rewrite_post': {
        const post = resolvePost(task, posts);
        if (!post) { replyParts.push(whichPost(task.reason)); break; }
        if (!task.instruction) { replyParts.push('What change should I make to that caption?'); break; }
        await propose('rewrite_post', { kind: 'rewrite', cycleId, postId: post.id, instruction: task.instruction }, rewriteSummary(post, task.reason));
        break;
      }
      case 'add_post': {
        const date = task.toDate ?? defaultAddDate(posts, today);
        await propose('add_post', { kind: 'add', cycleId, date, channel: task.channel ?? null }, addSummary(date, task.reason));
        break;
      }
      case 'add_note': {
        if (!task.content) { replyParts.push('What would you like me to note down?'); break; }
        const noteCycle = task.targetMonth ? await resolveCycleForMonth(clientId, task.targetMonth) : cycleId;
        await saveNote({ clientId, cycleId: noteCycle, content: task.content, source, relevantFrom: task.relevantFrom ?? null, relevantTo: task.relevantTo ?? null });
        const window = task.relevantFrom || task.relevantTo ? ` (relevant ${task.relevantFrom ?? '…'}–${task.relevantTo ?? '…'})` : '';
        replyParts.push(`• Noted: ${task.content}${window}`);
        break;
      }
      case 'query': {
        let answer: string;
        try {
          answer = await answerQuery(
            { clientId, cycleId, question: task.question ?? instruction, today },
            { model: getModelClient(), embeddingClient: getEmbeddingClient() },
          );
        } catch { answer = 'I couldn’t look that up just now — please try again.'; }
        replyParts.push(answer);
        break;
      }
      case 'clarify':
      default:
        replyParts.push(task.question ?? 'Could you say a bit more about what you’d like?');
        break;
    }
  }

  const message = replyParts.join('\n') || 'Okay.';
  const resp: AgentTurnResponse = { conversationId: convId, message, proposals, changeSetId: proposals.length ? changeSetId : null };

  await appendMessage({
    conversationId: convId, role: 'assistant', content: message,
    metadata: { tasks: tasks.map((t) => t.action), changeSetId: resp.changeSetId, proposalIds: proposals.map((p) => p.id) },
  });

  return NextResponse.json(resp);
}
