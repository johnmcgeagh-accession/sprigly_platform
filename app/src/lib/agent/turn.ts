/**
 * agent/turn.ts — the plan agent's parse → execute → persist core, factored out of
 * POST /api/plan/agent so BOTH the agent route and the post-cutoff branch of the intake
 * route (POST /api/plan/intake) create proposals through the SAME loop rather than a parallel
 * path. The route keeps only auth, rate-limit, and body parsing; everything below the
 * instruction is here.
 *
 * EVERY mutating task → a pending PROPOSAL (nothing applies here); add_note → a direct
 * plan_inputs write; query → inline answer; clarify → surfaced. All proposals from one call
 * share a changeSetId. Scoped to the (clientId, cycleId) passed in.
 */
import { randomUUID } from 'node:crypto';
import { loadPlanPosts } from '@/lib/plan';
import type { PlanPost } from '@/lib/types';
import { getModelClient, getEmbeddingClient } from '@/lib/agent/model';
import { parseTasks } from '@/lib/agent/task-parser';
import { getClientCycleMonths, getCycleMonth, resolveCycleForMonth, cycleDigest } from '@/lib/agent/cycle-state';
import { loadProductIndex } from '@/lib/agent/catalogue';
import { resolvePostSelector, resolveMoveSource, postTitle, parseISO } from '@/lib/agent/selectors';
import { moveSummary, deleteSummary, rewriteSummary, addSummary, formatSummary, generateHookSummary, refineSummary } from '@/lib/agent/summaries';
import { ensureConversation, appendMessage } from '@/lib/agent/conversation';
import { createProposal } from '@/lib/agent/proposals';
import { saveNote } from '@/lib/agent/notes';
import { answerQuery } from '@/lib/agent/query';
import { e2eTodayDate } from '@/lib/e2e-fake';
import { isEditableDate } from '@/lib/edit-scope';
import type { AgentTurnResponse, InterpretedItem, ParsedTask, ProposalView } from '@/lib/agent/types';

export interface AgentTurnArgs {
  clientId:        string;
  cycleId:         string;
  instruction:     string;
  source:          'web' | 'voice';
  sessionId?:      string | undefined;
  conversationId?: string | undefined;
}

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

/** 'YYYY-MM-DD' → '1 August' for human-facing agent copy. */
const dayMonth = (iso: string): string => {
  const d = parseISO(iso);
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()] ?? ''}`.trim();
};

/** Clarify copy that ALWAYS acknowledges what WAS understood (the destination, the source date the
 *  user named) — never asks for information they already gave. */
function moveNotFound(task: ParsedTask): string {
  const dest = task.toDate ? ` to ${dayMonth(task.toDate)}` : '';
  const where = task.fromDate ? ` on ${dayMonth(task.fromDate)}` : '';
  return `I understood you want to move a post${dest}, but I couldn’t find one${where}. Could you check the date, or name the post?`;
}
function moveAmbiguous(cands: PlanPost[], task: ParsedTask): string {
  const on = task.fromDate ? dayMonth(task.fromDate) : cands[0] ? dayMonth(cands[0].date) : 'that date';
  const dest = task.toDate ? ` to ${dayMonth(task.toDate)}` : '';
  const titles = cands.map((p) => `“${postTitle(p)}”`);
  const list = titles.length === 2 ? `${titles[0]} or ${titles[1]}` : `${titles.slice(0, -1).join(', ')}, or ${titles[titles.length - 1]}`;
  return `There are ${cands.length} posts on ${on} — ${list}? Which one should I move${dest}?`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
/** 'YYYY-MM' or 'YYYY-MM-DD' → 'August 2026' (falls back to the raw string). */
const monthName = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1] ?? iso} ${m[1]}` : iso;
};

/** Parse the instruction into tasks and execute them into proposals / notes / answers,
 *  persisting the conversation. Returns the same response shape the agent route returns. */
export async function runPlanAgentTurn(args: AgentTurnArgs): Promise<AgentTurnResponse> {
  const { clientId, cycleId, instruction, source } = args;

  const convId = await ensureConversation(clientId, cycleId, args.conversationId);
  const userMeta: Record<string, unknown> = { source };
  if (args.sessionId) userMeta.sessionId = args.sessionId;
  const userMessageId = await appendMessage({ conversationId: convId, role: 'user', content: instruction, source, metadata: userMeta });

  const posts = await loadPlanPosts(clientId, cycleId);
  const today = e2eTodayDate() ?? new Date();
  const todayNow = todayIso(today);
  const cycleMonth = await getCycleMonth(clientId, cycleId);

  // ── Parse (the only entry point) ──────────────────────────────────────────
  let tasks: ParsedTask[];
  try {
    const ctx = {
      today: todayNow,
      viewedMonth: cycleMonth ? monthName(cycleMonth) : 'this month',
      cycleMonths: await getClientCycleMonths(clientId, cycleId),
      planDigest: cycleDigest(posts),
      productIndex: await loadProductIndex(clientId, 'instagram'),
    };
    tasks = await parseTasks(instruction, ctx, getModelClient());
  } catch {
    tasks = [{ action: 'clarify', question: 'I couldn’t process that just now. Please try again in a moment.' }];
  }

  // ── Execute in message order ──────────────────────────────────────────────
  const changeSetId = randomUUID();
  const proposals: ProposalView[] = [];
  const replyParts: string[] = [];
  /**
   * The interpretation, built as each task resolves — which is the only place it CAN be built
   * honestly, because it is the only place both the structured task and the post row it resolved
   * to are in hand. Reconstructing it later from the proposal payload would mean re-reading the
   * post for its title, and re-reading is where a second answer to the same question starts.
   */
  const items: InterpretedItem[] = [];

  /**
   * Something the client asked for that we could not place.
   *
   * The sentence goes to BOTH channels on purpose: `replyParts` is the prose reply, which the
   * desktop surface and the conversation log still read, and `items` is what the sheet renders.
   * One source, two renderings — never two sentences that could disagree.
   */
  const cannot = (question: string) => { replyParts.push(question); items.push({ kind: 'unresolved', question }); };

  const propose = async (
    action: 'move_post' | 'delete_post' | 'rewrite_post' | 'add_post' | 'change_format' | 'generate_hook' | 'refine',
    payload: Parameters<typeof createProposal>[0]['payload'],
    summary: string,
    /** The itemised line, minus the id — which does not exist until the row is written. */
    change: Omit<Extract<InterpretedItem, { kind: 'change' }>, 'kind' | 'proposalId'>,
  ) => {
    const pv = await createProposal({ clientId, conversationId: convId, messageId: userMessageId, changeSetId, action, payload, summary });
    proposals.push(pv);
    items.push({ kind: 'change', proposalId: pv.id, ...change });
    return pv;
  };

  let lastAdd: { proposalId: string; format: string; topic: string } | null = null;
  const FMT_WORD: Record<string, string> = { reel: 'reel', carousel: 'carousel', single: 'single image', email: 'email' };

  for (const task of tasks) {
    switch (task.action) {
      case 'move_post': {
        const ref = resolveMoveSource(task, posts);
        if (!ref) { cannot(moveNotFound(task)); break; }
        if ('ambiguous' in ref) { cannot(moveAmbiguous(ref.ambiguous, task)); break; }
        const post = ref.post;
        if (!task.toDate) { cannot(`Move “${postTitle(post)}” to when?`); break; }
        // A move is refused on two grounds, and the cycle's STATUS is neither of them. A date
        // that has passed cannot be changed and cannot be moved onto — that is the whole rule
        // (`edit-scope.ts`), and the apply step enforces the same one. Everything future-dated
        // goes through, in whichever month the client is standing in.
        if (!isEditableDate(post.date, todayNow)) {
          cannot(`${dayMonth(post.date)} has already passed, so that post can’t move any more.`);
          break;
        }
        if (!isEditableDate(task.toDate, todayNow)) {
          cannot(`${dayMonth(task.toDate)} has already passed — I can only move posts to today or later. Which date did you have in mind?`);
          break;
        }
        // The one remaining limit is real and is not about permission: a post lives in the cycle
        // that plans its month, and nothing yet carries it into a different one. `cycleMonth` is
        // the month this cycle PLANS, so this now compares two plan-month dates. It used to
        // compare a plan date against the stored data month — never equal, which is why every
        // in-month move came back refused.
        if (cycleMonth && task.toDate.slice(0, 7) !== cycleMonth) {
          cannot(`That would move the post into ${monthName(task.toDate)} — moving posts to a different month isn’t available yet.`);
          break;
        }
        await propose('move_post', { kind: 'move', cycleId, postId: post.id, toDate: task.toDate }, moveSummary(post, task.toDate, task.reason),
          { action: 'move', title: postTitle(post), fromDate: post.date, toDate: task.toDate });
        break;
      }
      case 'delete_post': {
        const post = resolvePost(task, posts);
        if (!post) { cannot(whichPost(task.reason)); break; }
        await propose('delete_post', { kind: 'delete', cycleId, postId: post.id }, deleteSummary(post, task.reason),
          { action: 'remove', title: postTitle(post), fromDate: post.date });
        break;
      }
      case 'rewrite_post': {
        const post = resolvePost(task, posts);
        if (!post) { cannot(whichPost(task.reason)); break; }
        if (!task.instruction) { cannot('What change should I make to that caption?'); break; }
        await propose('rewrite_post', { kind: 'rewrite', cycleId, postId: post.id, instruction: task.instruction }, rewriteSummary(post, task.reason),
          { action: 'rewrite', title: postTitle(post), fromDate: post.date });
        break;
      }
      case 'change_format': {
        const post = resolvePost(task, posts);
        if (!post) { cannot(whichPost(task.reason)); break; }
        if (!task.format) { cannot('Which format should it be: reel, carousel or single image?'); break; }
        if (task.format === post.format) { cannot(`“${postTitle(post)}” is already a ${task.format}.`); break; }
        await propose('change_format', { kind: 'format', cycleId, postId: post.id, format: task.format }, formatSummary(post, task.format, task.reason),
          { action: 'format', title: postTitle(post), fromDate: post.date, format: task.format });
        break;
      }
      case 'add_post': {
        const date = task.toDate ?? defaultAddDate(posts, today);
        const inferred = task.format === 'reel' || task.format === 'carousel' || task.format === 'single';
        const format = inferred ? task.format! : 'single';
        const pv = await propose('add_post',
          { kind: 'add', cycleId, date, channel: task.channel ?? null, instruction: task.instruction ?? null, format },
          addSummary(date, format, inferred, task.reason, task.instruction),
          // `instruction` is the SUBJECT the parser extracted, which is structured intent. It is
          // deliberately not `reason` — that is the model's paraphrase of their phrasing, i.e.
          // the transcript echo this whole rendering exists to replace.
          { action: 'add', title: task.instruction?.trim() || null, toDate: date, format });
        lastAdd = { proposalId: pv.id, format, topic: task.instruction?.trim() || task.reason?.trim() || 'the new post' };
        break;
      }
      case 'generate_hook': {
        if (task.postId || task.selector) {
          const post = resolvePost(task, posts);
          if (!post) { cannot(whichPost(task.reason)); break; }
          if (post.format !== 'reel' && post.format !== 'carousel') {
            cannot(`Hooks apply to reels and carousels. “${postTitle(post)}” is ${FMT_WORD[post.format] === 'single image' ? 'a single image' : `an ${FMT_WORD[post.format]}`}. Want me to make it a reel first, then add hooks?`);
            break;
          }
          await propose('generate_hook', { kind: 'generate_hook', cycleId, postId: post.id }, generateHookSummary(`“${postTitle(post)}”`, task.reason),
            { action: 'hook', title: postTitle(post), fromDate: post.date });
          break;
        }
        if (!lastAdd) { cannot('Which post should I generate hooks for? Name its date, or ask me to create the reel first.'); break; }
        if (lastAdd.format !== 'reel' && lastAdd.format !== 'carousel') {
          cannot(`Hooks apply to reels and carousels. Want me to make “${lastAdd.topic}” a reel so I can add hooks?`);
          break;
        }
        await propose('generate_hook', { kind: 'generate_hook', cycleId, refProposalId: lastAdd.proposalId }, generateHookSummary(`the new reel “${lastAdd.topic}”`, task.reason),
          { action: 'hook', title: lastAdd.topic });
        break;
      }
      case 'refine': {
        const target = task.target === 'hook' || task.target === 'script' ? task.target : null;
        if (!target || !task.instruction) { cannot('Should I refine the hook or the script, and what change?'); break; }
        if (task.postId || task.selector) {
          const post = resolvePost(task, posts);
          if (!post) { cannot(whichPost(task.reason)); break; }
          const formatOk = target === 'hook' ? (post.format === 'reel' || post.format === 'carousel') : post.format === 'reel';
          if (!formatOk) {
            cannot(`${target === 'hook' ? 'Hooks' : 'Scripts'} apply to ${target === 'hook' ? 'reels and carousels' : 'reels'}. “${postTitle(post)}” is ${FMT_WORD[post.format] === 'single image' ? 'a single image' : `an ${FMT_WORD[post.format]}`}.`);
            break;
          }
          const field = target === 'hook' ? post.hook : post.script;
          if (!field || !field.trim()) {
            cannot(target === 'hook'
              ? `There’s no hook on “${postTitle(post)}” yet. Want me to generate some hooks first?`
              : `There’s no script on “${postTitle(post)}” yet. Open it and use Generate script first, then I can refine it.`);
            break;
          }
          await propose('refine', { kind: 'refine', cycleId, postId: post.id, target, instruction: task.instruction }, refineSummary(target, `“${postTitle(post)}”`, task.reason),
            { action: 'refine', title: postTitle(post), fromDate: post.date, target });
          break;
        }
        if (!lastAdd) { cannot(`Which post’s ${target} should I refine? Name its date.`); break; }
        await propose('refine', { kind: 'refine', cycleId, refProposalId: lastAdd.proposalId, target, instruction: task.instruction }, refineSummary(target, `the new reel “${lastAdd.topic}”`, task.reason),
          { action: 'refine', title: lastAdd.topic, target });
        break;
      }
      case 'add_note': {
        if (!task.content) { cannot('What would you like me to note down?'); break; }
        const noteCycle = task.targetMonth ? await resolveCycleForMonth(clientId, task.targetMonth) : cycleId;
        await saveNote({ clientId, cycleId: noteCycle, content: task.content, source, relevantFrom: task.relevantFrom ?? null, relevantTo: task.relevantTo ?? null });
        const window = task.relevantFrom || task.relevantTo ? ` (relevant ${task.relevantFrom ?? '…'} to ${task.relevantTo ?? '…'})` : '';
        replyParts.push(`Noted: ${task.content}${window}`);
        // The honest state, and the same one the intake receipts already render: it is on record,
        // it is not on the calendar. Nothing to apply — it is already saved.
        items.push({ kind: 'idea', text: task.content });
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
        // A clarify IS an unresolved item: the client asked for something and we could not place
        // it. Rendering it in the list beside the changes we DID place is the whole point — a
        // two-intent utterance where one half landed must show both halves.
        cannot(task.question ?? 'Could you say a bit more about what you’d like?');
        break;
    }
  }

  const message = replyParts.join('\n') || (proposals.length ? '' : 'Okay.');
  const resp: AgentTurnResponse = { conversationId: convId, message, proposals, items, changeSetId: proposals.length ? changeSetId : null };

  await appendMessage({
    conversationId: convId, role: 'assistant',
    content: message || `Proposed ${proposals.length} change${proposals.length === 1 ? '' : 's'} for review.`,
    metadata: { tasks: tasks.map((t) => t.action), changeSetId: resp.changeSetId, proposalIds: proposals.map((p) => p.id) },
  });

  return resp;
}
