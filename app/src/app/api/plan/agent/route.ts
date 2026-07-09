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
import { resolvePostSelector, postTitle } from '@/lib/agent/selectors';
import { moveSummary, deleteSummary, rewriteSummary, addSummary, formatSummary, generateHookSummary, refineSummary } from '@/lib/agent/summaries';
import { ensureConversation, appendMessage } from '@/lib/agent/conversation';
import { createProposal } from '@/lib/agent/proposals';
import { saveNote } from '@/lib/agent/notes';
import { answerQuery } from '@/lib/agent/query';
import { e2eTodayDate } from '@/lib/e2e-fake';
import { allowRequest } from '@/lib/rate-limit';
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
  `I couldn’t tell which post you meant${reason ? ` for “${reason.trim()}”` : ''}. Could you name its date?`;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const { clientId, cycleId } = session;

  // Interim per-share-link rate limit (see design/DECISIONS.md). Keyed by the token's
  // scope; the client surfaces the 429 as an inline "too quickly" message.
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

  const convId = await ensureConversation(clientId, cycleId, conversationId);
  const userMeta: Record<string, unknown> = { source };
  if (voiceSessionId) userMeta.sessionId = voiceSessionId;
  const userMessageId = await appendMessage({ conversationId: convId, role: 'user', content: instruction, source, metadata: userMeta });

  const posts = await loadPlanPosts(clientId, cycleId);
  const today = e2eTodayDate() ?? new Date();

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
    tasks = [{ action: 'clarify', question: 'I couldn’t process that just now. Please try again in a moment.' }];
  }

  // ── Execute in message order ──────────────────────────────────────────────
  const changeSetId = randomUUID();
  const proposals: ProposalView[] = [];
  const replyParts: string[] = [];

  // Proposal summaries are NOT pushed into the message — they render as their own
  // action rows (with inline Approve/Discard) in the extraction block. The message
  // carries only the conversational parts (answers, notes, clarifications) as clean
  // prose, so there are no orphan "• …" bullets duplicating the rows. (UAT round 1.)
  const propose = async (action: 'move_post' | 'delete_post' | 'rewrite_post' | 'add_post' | 'change_format' | 'generate_hook' | 'refine', payload: Parameters<typeof createProposal>[0]['payload'], summary: string) => {
    const pv = await createProposal({ clientId, conversationId: convId, messageId: userMessageId, changeSetId, action, payload, summary });
    proposals.push(pv);
    return pv;
  };

  // The most recent add_post proposal created in THIS turn — a generate_hook with no post
  // reference (a compound "create a reel … with a hook") links to it, so the hook resolves
  // against the post that add will create on approval.
  let lastAdd: { proposalId: string; format: string; topic: string } | null = null;
  const FMT_WORD: Record<string, string> = { reel: 'reel', carousel: 'carousel', single: 'single image', email: 'email' };

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
      case 'change_format': {
        const post = resolvePost(task, posts);
        if (!post) { replyParts.push(whichPost(task.reason)); break; }
        if (!task.format) { replyParts.push('Which format should it be: reel, carousel or single image?'); break; }
        if (task.format === post.format) { replyParts.push(`“${post.caption?.split('\n')[0] || post.pillar}” is already a ${task.format}.`); break; }
        await propose('change_format', { kind: 'format', cycleId, postId: post.id, format: task.format }, formatSummary(post, task.format, task.reason));
        break;
      }
      case 'add_post': {
        const date = task.toDate ?? defaultAddDate(posts, today);
        // Inferred format from the ask (Part 2); no signal → default single, shown as a
        // correctable note in the summary so the client can change it before approving.
        const inferred = task.format === 'reel' || task.format === 'carousel' || task.format === 'single';
        const format = inferred ? task.format! : 'single';
        const pv = await propose('add_post',
          { kind: 'add', cycleId, date, channel: task.channel ?? null, instruction: task.instruction ?? null, format },
          addSummary(date, format, inferred, task.reason, task.instruction));
        lastAdd = { proposalId: pv.id, format, topic: task.instruction?.trim() || task.reason?.trim() || 'the new post' };
        break;
      }
      case 'generate_hook': {
        // Existing-post reference → validate it's a reel/carousel, else guide (never a
        // silent drop or an invalid proposal).
        if (task.postId || task.selector) {
          const post = resolvePost(task, posts);
          if (!post) { replyParts.push(whichPost(task.reason)); break; }
          if (post.format !== 'reel' && post.format !== 'carousel') {
            replyParts.push(`Hooks apply to reels and carousels. “${postTitle(post)}” is ${FMT_WORD[post.format] === 'single image' ? 'a single image' : `an ${FMT_WORD[post.format]}`}. Want me to make it a reel first, then add hooks?`);
            break;
          }
          await propose('generate_hook', { kind: 'generate_hook', cycleId, postId: post.id }, generateHookSummary(`“${postTitle(post)}”`, task.reason));
          break;
        }
        // No reference → link to the reel/carousel being created in this same ask.
        if (!lastAdd) { replyParts.push('Which post should I generate hooks for? Name its date, or ask me to create the reel first.'); break; }
        if (lastAdd.format !== 'reel' && lastAdd.format !== 'carousel') {
          replyParts.push(`Hooks apply to reels and carousels. Want me to make “${lastAdd.topic}” a reel so I can add hooks?`);
          break;
        }
        await propose('generate_hook', { kind: 'generate_hook', cycleId, refProposalId: lastAdd.proposalId }, generateHookSummary(`the new reel “${lastAdd.topic}”`, task.reason));
        break;
      }
      case 'refine': {
        const target = task.target === 'hook' || task.target === 'script' ? task.target : null;
        if (!target || !task.instruction) { replyParts.push('Should I refine the hook or the script, and what change?'); break; }
        // Existing post → validate format + that the field EXISTS (empty → offer generation).
        if (task.postId || task.selector) {
          const post = resolvePost(task, posts);
          if (!post) { replyParts.push(whichPost(task.reason)); break; }
          const formatOk = target === 'hook' ? (post.format === 'reel' || post.format === 'carousel') : post.format === 'reel';
          if (!formatOk) {
            replyParts.push(`${target === 'hook' ? 'Hooks' : 'Scripts'} apply to ${target === 'hook' ? 'reels and carousels' : 'reels'}. “${postTitle(post)}” is ${FMT_WORD[post.format] === 'single image' ? 'a single image' : `an ${FMT_WORD[post.format]}`}.`);
            break;
          }
          const field = target === 'hook' ? post.hook : post.script;
          if (!field || !field.trim()) {
            replyParts.push(target === 'hook'
              ? `There’s no hook on “${postTitle(post)}” yet. Want me to generate some hooks first?`
              : `There’s no script on “${postTitle(post)}” yet. Open it and use Generate script first, then I can refine it.`);
            break;
          }
          await propose('refine', { kind: 'refine', cycleId, postId: post.id, target, instruction: task.instruction }, refineSummary(target, `“${postTitle(post)}”`, task.reason));
          break;
        }
        // No reference → a refine of a field on a post created earlier in this same ask.
        if (!lastAdd) { replyParts.push(`Which post’s ${target} should I refine? Name its date.`); break; }
        await propose('refine', { kind: 'refine', cycleId, refProposalId: lastAdd.proposalId, target, instruction: task.instruction }, refineSummary(target, `the new reel “${lastAdd.topic}”`, task.reason));
        break;
      }
      case 'add_note': {
        if (!task.content) { replyParts.push('What would you like me to note down?'); break; }
        const noteCycle = task.targetMonth ? await resolveCycleForMonth(clientId, task.targetMonth) : cycleId;
        await saveNote({ clientId, cycleId: noteCycle, content: task.content, source, relevantFrom: task.relevantFrom ?? null, relevantTo: task.relevantTo ?? null });
        const window = task.relevantFrom || task.relevantTo ? ` (relevant ${task.relevantFrom ?? '…'} to ${task.relevantTo ?? '…'})` : '';
        replyParts.push(`Noted: ${task.content}${window}`);
        break;
      }
      case 'query': {
        let answer: string;
        try {
          answer = await answerQuery(
            { clientId, cycleId, question: task.question ?? instruction, today },
            { model: getModelClient(), embeddingClient: getEmbeddingClient() },
          );
        } catch { answer = 'I couldn’t look that up just now. Please try again.'; }
        replyParts.push(answer);
        break;
      }
      case 'clarify':
      default:
        replyParts.push(task.question ?? 'Could you say a bit more about what you’d like?');
        break;
    }
  }

  // Conversational parts only (proposals render as rows). Empty when the turn is
  // purely proposals — the extraction block's rows carry the summary.
  const message = replyParts.join('\n') || (proposals.length ? '' : 'Okay.');
  const resp: AgentTurnResponse = { conversationId: convId, message, proposals, changeSetId: proposals.length ? changeSetId : null };

  await appendMessage({
    conversationId: convId, role: 'assistant',
    content: message || `Proposed ${proposals.length} change${proposals.length === 1 ? '' : 's'} for review.`,
    metadata: { tasks: tasks.map((t) => t.action), changeSetId: resp.changeSetId, proposalIds: proposals.map((p) => p.id) },
  });

  return NextResponse.json(resp);
}
