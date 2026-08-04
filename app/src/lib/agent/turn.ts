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
import type { PlanPost } from '@/lib/types';
import { getModelClient, getEmbeddingClient } from '@/lib/agent/model';
import { createAuditLogger } from '@sprigly/audit';
import { db } from '@sprigly/db';
import { parseTasks } from '@/lib/agent/task-parser';
import { resolveCycleForMonth } from '@/lib/agent/cycle-state';
import { buildPlanContext } from '@/lib/agent/plan-context';
import { loadProductIndex } from '@/lib/agent/catalogue';
import { resolveTargets, resolveMoveSource, postTitle, titleFromSubject, parseISO } from '@/lib/agent/selectors';
import { moveSummary, deleteSummary, rewriteSummary, addSummary, formatSummary, generateHookSummary, refineSummary } from '@/lib/agent/summaries';
import { ensureConversation, appendMessage, listTurns, threadForParser, latestPendingIntent, intentForParser } from '@/lib/agent/conversation';
import { createProposal, loadPendingPayloads, rejectProposal } from '@/lib/agent/proposals';
import { saveNote } from '@/lib/agent/notes';
import { answerQuery } from '@/lib/agent/query';
import { editScopeToday, isEditableDate, loadDraftCycles } from '@/lib/edit-scope';
import { getUsageForCycle, remainingAiChanges } from '@/lib/usage';
import { capAnnouncement } from '@sprigly/engine/ai-change-cap';
import type { AgentTurnResponse, CapNotice, InterpretedItem, ParsedTask, PendingIntent, ProposalView } from '@/lib/agent/types';
import type { AgentTurnOutcome } from '@sprigly/db';

export interface AgentTurnArgs {
  clientId:        string;
  cycleId:         string;
  instruction:     string;
  source:          'web' | 'voice';
  sessionId?:      string | undefined;
  conversationId?: string | undefined;
  /**
   * The proposals the client is LOOKING AT and has not applied — the interpretation turn still
   * open on their screen (C3). Sent by the sheet, because only the sheet knows which of the
   * client's pending proposals is the one in front of them right now.
   */
  pendingProposalIds?: readonly string[] | undefined;
}

const todayIso = (d = new Date()): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * THE AGENT'S "TODAY" IS THE GATE'S "TODAY".
 *
 * This function used to be called with `e2eTodayDate() ?? new Date()` and read through
 * `getFullYear/getMonth/getDate` — i.e. the SERVER's local calendar. Every editability decision
 * in the product is made in Europe/London (`edit-scope.ts:17` → `steps.ts:resolveTodayIso`), and
 * on a UTC host between 23:00 and midnight London time those two are a DIFFERENT DAY. So the
 * agent could tell a client a date was still open that the write path would then refuse, or the
 * reverse, and no test would ever see it because both clocks agree in CI.
 *
 * One source now. `editScopeToday()` also honours the non-prod e2e freeze, so the frozen-day
 * fixtures keep working through the same door as production.
 */
const agentToday = (): { iso: string; date: Date } => {
  const iso = editScopeToday();
  return { iso, date: parseISO(iso) };
};

/**
 * Resolve a task's post reference: the model's postId (verified), else the selector through
 * `resolveTargets` — which, with `today`, resolves a bare weekday to the NEXT such day (F3a).
 * Returns the post, the AMBIGUOUS candidate set (several posts on the resolved day — the
 * caller lists them), or null (nothing matched / a hallucinated id).
 */
type PostRef = { post: PlanPost } | { ambiguous: PlanPost[] } | null;
function resolvePostRef(task: ParsedTask, posts: PlanPost[], today: string, viewedPosts: PlanPost[] = posts): PostRef {
  if (task.postId) {
    const byId = posts.find((p) => p.id === task.postId);
    if (byId) return { post: byId };
  }
  if (task.selector) {
    /**
     * ── THE MONTH ON SCREEN GETS FIRST REFUSAL (F2) ──────────────────────────────────
     *
     * The candidate set now spans every month the client can act in, which is what makes a
     * reference to another month resolve at all. It also means a bare in-month reference —
     * "the 16th", "the linen one" — can match five months' worth of posts and come back
     * ambiguous where it used to be certain.
     *
     * So the VIEWED month is tried first and wins outright when it answers with exactly one
     * post. That is what "the 16th" means to someone looking at August, and it is what the
     * parser is told to assume. Only when the month on screen does not answer — no match, or
     * several — does the reference reach across, which is precisely the case the client had to
     * name another month to create.
     */
    const inView = resolveTargets(task.selector, viewedPosts, today);
    if (inView.length === 1) return { post: inView[0]! };
    // The month on screen answering with SEVERAL is an ambiguity in its own right, and those
    // are the candidates to put to the client. Widening it to five months' worth of the same
    // day-number would turn "there are 2 posts on the 16th" into "there are 4", over posts in
    // months the client never mentioned.
    if (inView.length > 1) return { ambiguous: inView };
    const hits = resolveTargets(task.selector, posts, today);
    if (hits.length === 1) return { post: hits[0]! };
    if (hits.length > 1) return { ambiguous: hits };
  }
  return null;
}

/**
 * A sensible default date for an add_post with no date: two days after the last scheduled
 * post, else a week out — held inside the plan month's own calendar.
 *
 * THE SECOND max(scheduled_date) DERIVATION (G2). This one is a real placement rather than a
 * sentence, and it had the same fault in the other direction: with the last post on the 30th,
 * "two days after" is the 1st of the NEXT month — a post proposed into a month this cycle does
 * not plan, which the move guard would then refuse to move back. Clamped to the plan month,
 * and never behind today, so the default is always a date the client can actually keep.
 */
function defaultAddDate(posts: PlanPost[], today: Date, planMonth?: string | null): string {
  const dates = posts.map((p) => p.date).sort();
  const base = dates.length ? new Date(`${dates[dates.length - 1]}T00:00:00`) : today;
  const d = new Date(base); d.setDate(d.getDate() + (dates.length ? 2 : 7));
  const iso = todayIso(d);
  if (!planMonth || !/^\d{4}-\d{2}$/.test(planMonth)) return iso;
  const [y, m] = planMonth.split('-').map(Number);
  const first = `${planMonth}-01`;
  const last = `${planMonth}-${String(new Date(y!, m!, 0).getDate()).padStart(2, '0')}`;
  const clamped = iso < first ? first : iso > last ? last : iso;
  // A clamp backwards can land behind today; today itself is addable, so that is the floor.
  return clamped < todayIso(today) ? todayIso(today) : clamped;
}

const whichPost = (reason?: string | null) =>
  `I couldn’t tell which post you meant${reason ? ` for “${reason.trim()}”` : ''}. Could you name its date?`;

/** Ambiguity, LISTING the candidates (F3a): the question names the day and the posts on it,
 *  so answering it is picking from a list rather than guessing what we can see. */
function whichOfThese(cands: PlanPost[], reason?: string | null): string {
  const on = cands[0] && cands.every((p) => p.date === cands[0]!.date) ? ` on ${dayMonth(cands[0]!.date)}` : '';
  const titles = cands.map((p) => `“${postTitle(p)}”`);
  const list = titles.length === 2 ? `${titles[0]} or ${titles[1]}` : `${titles.slice(0, -1).join(', ')}, or ${titles[titles.length - 1]}`;
  return `There are ${cands.length} posts${on} — ${list}? Which one did you mean${reason ? ` by “${reason.trim()}”` : ''}?`;
}

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

/**
 * 'YYYY-MM' → that month's first and last day, as the relevance window (F5).
 *
 * The upper bound is computed from the month's own calendar rather than written as a literal:
 * a `${month}-31` bound is an INVALID DATE for September, April, June, November and February,
 * and Postgres rejects it against a `date` column rather than clamping — the same trap
 * `intake-signals.ts:firstOfMonthAfter` documents having already been caught by once.
 *
 * Returns nulls for anything that is not a month, so a malformed value files an undated note
 * rather than a note with half a window.
 */
function monthWindow(month?: string | null): { from: string | null; to: string | null } {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return { from: null, to: null };
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y!, m!, 0)).getUTCDate();   // day 0 of the NEXT month
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

/** '<ErrorName>' for the ledger — never the message, which can carry a client id or a whole
 *  prompt fragment and is stored. The NAME is what triage keys on. */
const errName = (e: unknown): string =>
  (e instanceof Error && e.name ? e.name : typeof e === 'string' ? 'string' : 'Unknown');

/**
 * WHAT HAPPENED ON THIS TURN, as one value (0092).
 *
 * Strict precedence, and the order is the whole point:
 *
 *   errored    — anything threw. NEVER masked by a later success, because a failure a cheerier
 *                outcome hides is a failure nobody will ever query for.
 *   declined   — the answerer correctly said it does not have something on file. A GOOD outcome,
 *                and the one that used to be byte-identical to both a good answer and a throw.
 *   answered   — a query answered from context.
 *   changed    — proposals created.
 *   noted      — an idea or note recorded.
 *   clarified  — we asked something, or could not place the request.
 *   unknown    — none of the above described it. Honest, and never a synonym for success.
 *
 * A query whose answerer emitted no tag lands on 'unknown' rather than 'answered' for the same
 * reason: this instrumentation exists because silence was being read as success.
 */
function turnOutcome(args: {
  thrown: string | null;
  queryOutcome: 'answered' | 'declined' | 'unknown' | null;
  proposals: number;
  noted: boolean;
  items: readonly InterpretedItem[];
}): AgentTurnOutcome {
  if (args.thrown) return 'errored';
  if (args.queryOutcome === 'declined') return 'declined';
  if (args.queryOutcome === 'answered') return 'answered';
  if (args.proposals > 0) return 'changed';
  if (args.noted) return 'noted';
  if (args.queryOutcome === 'unknown') return 'unknown';
  if (args.items.some((i) => i.kind === 'unresolved')) return 'clarified';
  return 'unknown';
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

  /**
   * THE COST LEDGER FOR THIS TURN.
   *
   * One per turn, shared by both calls that can spend here — the parse (always) and the query
   * answerer (only on a "query" task). Both write behind their own try/catch, so a ledger that
   * cannot write never changes what the client is told.
   */
  const audit = createAuditLogger(db);

  const convId = await ensureConversation(clientId, cycleId, args.conversationId);
  // THE THREAD, read BEFORE this turn's message lands so the window is the conversation as it
  // stood when the client spoke. "Move it back" resolves against the previous exchange, and the
  // previous exchange is what this captures — assistant turns serialised from their RESOLVED
  // items (titles + ISO dates), never from prose.
  let recentThread = '';
  /**
   * ── THE PENDING INTENT (G1) ──────────────────────────────────────────────────────────
   *
   * The change the LAST assistant turn was still assembling when it asked its question. It
   * rides into the prompt as its own block so this utterance is read as the ANSWER before it
   * is read as anything else — which is the whole of the raspberry failure: "Reels" had no
   * question to belong to, so it could only be a verbless noun to ask about.
   *
   * Read from the SAME listTurns call as the thread, because it is the same fact about the
   * same conversation and a second read could disagree with the first.
   */
  let openIntent: PendingIntent | null = null;
  try {
    const turns = await listTurns(clientId, convId);
    recentThread = threadForParser(turns);
    openIntent = latestPendingIntent(turns);
  }
  catch { /* an unreadable thread degrades to a threadless turn, never a failed one */ }
  const userMeta: Record<string, unknown> = { source };
  if (args.sessionId) userMeta.sessionId = args.sessionId;
  // A client's own message has no outcome and must not claim one — 'user' says exactly that.
  const userMessageId = await appendMessage({ conversationId: convId, role: 'user', content: instruction, source, metadata: userMeta, writer: 'plan-agent', outcome: 'user' });

  const { iso: todayNow, date: today } = agentToday();
  /**
   * ── THE CONTEXT SEAM (X1a) ───────────────────────────────────────────────────────────
   *
   * ONE call for everything the agent knows about the plan: which months it can see, their
   * posts, and the digest. It spans the viewed cycle and its neighbours plus the cycle holding
   * today (`plan-context.ts` states the rule and the reasons). This turn loop never reads a
   * cycle directly again — when the context becomes tool use, `buildPlanContext` is what is
   * replaced, and nothing below moves.
   */
  const planCtx = await buildPlanContext(clientId, cycleId, todayNow);
  /** THE RESOLUTION SET: every post in scope, across months. A reference can only ever reach a
   *  post that is in here, which is exactly why August was untouchable from October. */
  const posts = planCtx.posts;
  /** The month on screen, alone — for placement decisions that belong to it rather than to the
   *  span (an undated add is placed here, not across three months). */
  const viewedPosts = planCtx.cycles.find((c) => c.cycleId === cycleId)?.posts ?? [];
  const cycleMonth = planCtx.viewedMonth;

  /**
   * The cycle that will OWN a date, resolved from the date's own month. Memoised per turn
   * because a compound request ("add three posts in September") asks the same question three
   * times, and this is a database read.
   *
   * It looks past the SPAN deliberately: the span governs what can be READ (which posts a
   * reference resolves against), not where a change may LAND. A client with a March cycle can
   * be given a March post from the August view even though March's rows were never loaded.
   */
  /**
   * ── THE MONTHS THAT ARE STILL DRAFTS ─────────────────────────────────────────────────
   *
   * Read ONCE per turn, because a compound request ("add three posts in September") asks the
   * same question three times and this is a database read. Plan months ('YYYY-MM'), from
   * `loadDraftCycles` — the same predicate `resolveSurfaceKind` uses, so what the agent
   * refuses and what the surface renders can never disagree.
   *
   * An unreadable answer degrades to "no draft months", which leaves the guard below inert
   * and the `mutations.ts` refusal as the backstop: a failed read must never be the thing
   * that stops a client editing a live month.
   */
  const draftMonths = await loadDraftCycles(clientId)
    .then((d) => new Set(d.byPlanMonth.keys()))
    .catch(() => new Set<string>());

  const cycleForMonthCache = new Map<string, string | null>();
  const cycleForMonth = async (month: string): Promise<string | null> => {
    if (cycleForMonthCache.has(month)) return cycleForMonthCache.get(month)!;
    const inSpan = planCtx.cycles.find((c) => c.planMonth === month)?.cycleId ?? null;
    const id = inSpan ?? await resolveCycleForMonth(clientId, month).catch(() => null);
    cycleForMonthCache.set(month, id);
    return id;
  };

  /**
   * ── THE PENDING CHANGE IS THE REFERENT (C3) ──────────────────────────────────────────
   *
   * An interpretation the client has NOT applied is the most recent thing said AND the thing
   * on their screen, so a correction with no target of its own is about IT. "Instead of a
   * single image make it a reel" was landing as a `change_format` against a post that does not
   * exist yet — the add was still a proposal — and the client ended up with two adds or none.
   *
   * Only rows that are STILL pending count: the sheet's list is what it last knew, and a
   * proposal applied or discarded since is not what they are looking at.
   */
  const pending = await loadPendingPayloads(clientId, args.pendingProposalIds ?? []);
  const pendingBlock = pending.length
    ? pending.map((p) => `- id=${p.id} | ${p.intent} | ${JSON.stringify(p.payload)}`).join('\n')
    : '';

  // ── Parse (the only entry point) ──────────────────────────────────────────
  let tasks: ParsedTask[];
  try {
    const ctx = {
      today: todayNow,
      viewedMonth: cycleMonth ? monthName(cycleMonth) : 'this month',
      cycleMonths: planCtx.allMonths,
      // The SPAN's digest: every month in scope, each row carrying its ISO date and its own
      // side of today (computed with `isEditableDate`, the write gate's predicate), under a
      // window line naming every month rather than one (G2's rule, generalised by X1a).
      planDigest: planCtx.digest,
      productIndex: await loadProductIndex(clientId, 'instagram'),
      recentThread,
      ...(pendingBlock ? { pending: pendingBlock } : {}),
      ...(openIntent ? { intent: intentForParser(openIntent) } : {}),
    };
    tasks = await parseTasks(instruction, ctx, getModelClient(), { audit, clientId });
  } catch (err) {
    // Everything OUTSIDE parseTasks' own try: building the context (a cycle read, the catalogue),
    // resolving the model client, or parseTasks itself failing in a way it does not catch. The
    // client copy is unchanged; the row now says an error produced it.
    tasks = [{ action: 'clarify', question: 'I couldn’t process that just now. Please try again in a moment.', parseError: `context:${errName(err)}` }];
  }

  // ── Execute in message order ──────────────────────────────────────────────
  const changeSetId = randomUUID();
  const proposals: ProposalView[] = [];
  const replyParts: string[] = [];
  /**
   * ── WHAT ACTUALLY HAPPENED ON THIS TURN (0092) ───────────────────────────────────────
   *
   * `thrown` is the FIRST error kind caught anywhere in this turn, and it is sticky: once set it
   * is never cleared, so a turn that threw and then went on to do something useful is still
   * recorded as errored. A failure that is masked by a later success is a failure nobody sees,
   * which is precisely the state this instrumentation replaces.
   *
   * `queryOutcome` is the query answerer's own verdict — 'declined' when it correctly told the
   * client it does not have something, which used to be indistinguishable from both a good
   * answer and a caught throw.
   */
  let thrown: string | null = null;
  let queryOutcome: 'answered' | 'declined' | 'unknown' | null = null;
  let notedSomething = false;
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

  /**
   * SUPERSEDE: an amending task replaces the pending change rather than standing beside it.
   *
   * The old proposal is REJECTED — which is exactly what the client meant by "instead of" —
   * and the new one is created by the ordinary path below, so the amendment goes through the
   * same derivation, the same guards and the same summary as any other change. The superseded
   * ids ride back on the response so the sheet can mark that turn and stop offering its Apply.
   *
   * Rejecting first is deliberate: if the new proposal then fails a guard (a past date, say),
   * the client is left with neither — which is the honest outcome of "not that one, this one"
   * where "this one" is refused, and far better than an Apply that silently does the thing
   * they just corrected.
   */
  const superseded: string[] = [];
  const supersedePending = async () => {
    for (const p of pending) {
      if (superseded.includes(p.id)) continue;
      await rejectProposal(clientId, p.id, 'client');
      superseded.push(p.id);
    }
  };

  for (const task of tasks) {
    // A clarify carrying `parseError` is a failure the client sees as an ordinary clarify —
    // synthesised either inside parseTasks (a throttle, malformed JSON) or by the catch above.
    if (task.parseError) thrown ??= task.parseError;
    if (task.amends && pending.length) await supersedePending();
    switch (task.action) {
      case 'move_post': {
        const ref = resolveMoveSource(task, posts, todayNow, viewedPosts);
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
        /**
         * ── THE MONTH IS NOT A PERMISSION (X1b) ────────────────────────────────────────
         *
         * This used to refuse any destination outside the viewed cycle's plan month, with the
         * words the operator screenshotted: *"moving posts to a different month isn't available
         * yet."* The permission rule is the DATE rule — today-or-later, plus ownership — and
         * both ends have already been checked above. What remains is not permission but
         * PLACEMENT: the destination month must be one the client can actually reach, or the
         * post moves somewhere they cannot navigate to and reads as vanished.
         *
         * The post keeps its own `cycle_id` (see the payload below). Cycles span BY DATE on the
         * calendar already — `loadCrossMonthPosts` (plan.ts) serves every post whose
         * scheduled_date falls in the viewed month whatever cycle owns it, and each post routes
         * its own edits through its own cycle. So a September date on an August post renders in
         * September and edits as September, with no row re-parented and no ordering, ledger or
         * quota accounting disturbed. That is the smallest correct version.
         */
        const destCycle = await cycleForMonth(task.toDate.slice(0, 7));
        if (!destCycle) {
          cannot(`I can’t move it into ${monthName(task.toDate)} — there’s no ${monthName(task.toDate)} plan yet, and I can’t make one. Pick a date in a month you already have.`);
          break;
        }
        // A DRAFT MONTH IS NOT A DESTINATION (see draftMonths above). A post keeps its own
        // cycle through a move, so this would not join the draft — it would leave this month's
        // grid and never appear in that one. Refused HERE rather than at apply, so the client
        // reads it instead of tapping Apply on a change that will not happen.
        if (draftMonths.has(task.toDate.slice(0, 7))) {
          cannot(`I can’t move it into ${monthName(task.toDate)} — that month is still a draft you haven’t approved, and the post would vanish from both months. Approve ${monthName(task.toDate)} first, or pick a date in a month that’s live.`);
          break;
        }
        // The proposal carries the POST'S OWN cycle, never the viewed one: the apply step scopes
        // its write by (client, cycle, post), so an August post moved from the October view
        // would find nothing to update if this said October.
        await propose('move_post', { kind: 'move', cycleId: post.cycleId, postId: post.id, toDate: task.toDate }, moveSummary(post, task.toDate, task.reason),
          { action: 'move', title: postTitle(post), fromDate: post.date, toDate: task.toDate });
        break;
      }
      case 'delete_post': {
        const ref = resolvePostRef(task, posts, todayNow, viewedPosts);
        if (!ref) { cannot(whichPost(task.reason)); break; }
        if ('ambiguous' in ref) { cannot(whichOfThese(ref.ambiguous, task.reason)); break; }
        const post = ref.post;
        await propose('delete_post', { kind: 'delete', cycleId: post.cycleId, postId: post.id }, deleteSummary(post, task.reason),
          { action: 'remove', title: postTitle(post), fromDate: post.date });
        break;
      }
      case 'rewrite_post': {
        const ref = resolvePostRef(task, posts, todayNow, viewedPosts);
        if (!ref) { cannot(whichPost(task.reason)); break; }
        if ('ambiguous' in ref) { cannot(whichOfThese(ref.ambiguous, task.reason)); break; }
        const post = ref.post;
        if (!task.instruction) { cannot('What change should I make to that caption?'); break; }
        await propose('rewrite_post', { kind: 'rewrite', cycleId: post.cycleId, postId: post.id, instruction: task.instruction }, rewriteSummary(post, task.reason),
          { action: 'rewrite', title: postTitle(post), fromDate: post.date });
        break;
      }
      case 'change_format': {
        const ref = resolvePostRef(task, posts, todayNow, viewedPosts);
        if (!ref) { cannot(whichPost(task.reason)); break; }
        if ('ambiguous' in ref) { cannot(whichOfThese(ref.ambiguous, task.reason)); break; }
        const post = ref.post;
        if (!task.format) { cannot('Which format should it be: reel, carousel or single image?'); break; }
        if (task.format === post.format) { cannot(`“${postTitle(post)}” is already a ${task.format}.`); break; }
        await propose('change_format', { kind: 'format', cycleId: post.cycleId, postId: post.id, format: task.format }, formatSummary(post, task.format, task.reason),
          { action: 'format', title: postTitle(post), fromDate: post.date, format: task.format });
        break;
      }
      case 'add_post': {
        // An UNDATED add is placed inside the month on screen, from THAT month's posts — not
        // from the span's. The span made `posts` multi-month, and "two days after the last post"
        // read across three months would put an August add into November.
        const date = task.toDate ?? defaultAddDate(viewedPosts, today, cycleMonth);
        /**
         * ── AN ADD LANDS IN THE MONTH ITS DATE NAMES (X1c) ────────────────────────────
         *
         * "add a post about X on 4 September" from the August view files under SEPTEMBER's
         * cycle, because a cycle plans a month and 4 September is September's. The viewed cycle
         * is where the client is standing, which is not the same fact.
         *
         * If that month has no cycle we REFUSE and say why. Inventing one is the one thing that
         * must not happen here: a cycle is a planning run with a brief, a fan-out and a cost, and
         * a row conjured by an add would be a month-shaped object with none of them.
         */
        const destCycle = await cycleForMonth(date.slice(0, 7));
        if (!destCycle) {
          cannot(`There’s no ${monthName(date)} plan yet, and I can’t start one — that’s a planning run, not an edit. Pick a date in a month you already have, or ask us to set ${monthName(date)} up.`);
          break;
        }
        // A DRAFT MONTH IS NOT A DESTINATION. This is the one that could destroy a month: the
        // row would go in as 'generating', which the draft reader cannot see and the plan reader
        // can, flipping the whole month out of its draft surface and hiding every planned post
        // in it. Refused at proposal time so nothing reaches an Apply the client would regret.
        if (draftMonths.has(date.slice(0, 7))) {
          cannot(`${monthName(date)} is still a draft you haven’t approved, so I can’t add to it from here — it would hide the posts already planned for it. Open ${monthName(date)} and tell me there: on a draft I can reshape the month directly.`);
          break;
        }
        const inferred = task.format === 'reel' || task.format === 'carousel' || task.format === 'single';
        const format = inferred ? task.format! : 'single';
        // `instruction` is the SUBJECT the parser extracted, which is structured intent. It is
        // deliberately not `reason` — that is the model's paraphrase of their phrasing, i.e.
        // the transcript echo this whole rendering exists to replace.
        const subject = task.instruction?.trim() || null;
        const pv = await propose('add_post',
          // X3: the TITLE travels with the change. It is the same string the interpretation line
          // below shows, so the row the client gets is headed with what they read and consented
          // to — rather than landing as "Untitled" until a caption exists to derive one from.
          { kind: 'add', cycleId: destCycle, date, channel: task.channel ?? null, instruction: subject, format, title: titleFromSubject(subject) },
          addSummary(date, format, inferred, task.reason, task.instruction),
          { action: 'add', title: subject, toDate: date, format });
        lastAdd = { proposalId: pv.id, format, topic: subject || task.reason?.trim() || 'the new post' };
        break;
      }
      case 'generate_hook': {
        if (task.postId || task.selector) {
          const ref = resolvePostRef(task, posts, todayNow, viewedPosts);
          if (!ref) { cannot(whichPost(task.reason)); break; }
          if ('ambiguous' in ref) { cannot(whichOfThese(ref.ambiguous, task.reason)); break; }
          const post = ref.post;
          if (post.format !== 'reel' && post.format !== 'carousel') {
            cannot(`Hooks apply to reels and carousels. “${postTitle(post)}” is ${FMT_WORD[post.format] === 'single image' ? 'a single image' : `an ${FMT_WORD[post.format]}`}. Want me to make it a reel first, then add hooks?`);
            break;
          }
          await propose('generate_hook', { kind: 'generate_hook', cycleId: post.cycleId, postId: post.id }, generateHookSummary(`“${postTitle(post)}”`, task.reason),
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
          const ref = resolvePostRef(task, posts, todayNow, viewedPosts);
          if (!ref) { cannot(whichPost(task.reason)); break; }
          if ('ambiguous' in ref) { cannot(whichOfThese(ref.ambiguous, task.reason)); break; }
          const post = ref.post;
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
          await propose('refine', { kind: 'refine', cycleId: post.cycleId, postId: post.id, target, instruction: task.instruction }, refineSummary(target, `“${postTitle(post)}”`, task.reason),
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
        /**
         * ── THE MONTH SURVIVES WHETHER OR NOT A CYCLE EXISTS (F5) ────────────────────────
         *
         * `targetMonth` used to be a CYCLE LOOKUP KEY and nothing else: resolve it, file the note
         * under that cycle, discard the month. So "I have an idea for October", parsed correctly
         * as `targetMonth: "2026-10"`, hit a client with no October cycle, resolved to null, and
         * was stored with `cycle_id = null` and no other trace — October surviving only as two
         * words inside the free text, reachable by nothing.
         *
         * The month is now written where the schema already means it: the relevance WINDOW. That
         * is not a second meaning bolted onto `relevant_from`/`relevant_to` — it is their first
         * one. Both readers apply the identical overlap predicate, one against a week
         * (`weekly-session.ts`) and one against a plan month (`intake-signals.ts:loadDurableInputs`,
         * shared verbatim by the planning gate and the generator), and `draft-apply.ts` already
         * writes a client-named future date into `relevant_from` for exactly this reason: filing
         * a dated ask as an undated one loses the part the client was most specific about.
         *
         * Applied whenever the client named a month and did not name a narrower window of their
         * own — one rule, not a special case for the branch that failed. A note scoped to its
         * month is also a note that stops being live when the month does, which is what
         * `expireStaleNotes` has always been for and what a null `relevant_to` never triggered.
         */
        const noteCycle = task.targetMonth ? await cycleForMonth(task.targetMonth) : cycleId;
        const named = task.relevantFrom || task.relevantTo
          ? { from: task.relevantFrom ?? null, to: task.relevantTo ?? null }
          : monthWindow(task.targetMonth);
        await saveNote({ clientId, cycleId: noteCycle, content: task.content, source, relevantFrom: named.from, relevantTo: named.to });
        const window = named.from || named.to ? ` (relevant ${named.from ?? '…'} to ${named.to ?? '…'})` : '';
        replyParts.push(`Noted: ${task.content}${window}`);
        // The honest state, and the same one the intake receipts already render: it is on record,
        // it is not on the calendar. Nothing to apply — it is already saved. The month rides along
        // so the surface can say WHICH month rather than claim there wasn't one.
        items.push({ kind: 'idea', text: task.content, month: task.targetMonth ?? null });
        notedSomething = true;
        break;
      }
      case 'query': {
        let answer: string;
        try {
          const res = await answerQuery(
            // The SPAN goes to the answerer (X1a/d): "what's happening next week" is a question
            // about dates, and it must not be answered from the month that happens to be up.
            { clientId, cycleId, question: task.question ?? instruction, today, context: planCtx },
            { model: getModelClient(), embeddingClient: getEmbeddingClient(), audit },
          );
          answer = res.text;
          // The answerer's OWN verdict (0092). A decline is a CORRECT outcome — the model saying
          // it does not have something is the behaviour the grounding contract asks for — and it
          // must be distinguishable from an answer, which string-matching the copy could not do.
          queryOutcome = res.outcome;
        } catch (err) {
          answer = 'I couldn’t look that up just now. Please try again.';
          // This sentence used to be stored as a successful `tasks: ["query"]` row. It is a throw.
          thrown ??= `answer-query:${errName(err)}`;
        }
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

  /**
   * ── WHAT THIS TURN IS STILL ASSEMBLING ───────────────────────────────────────────────
   *
   * The intent the parser attached to a clarify, if it attached one — the change we are still
   * writing down, carried on this turn so the NEXT one can read the client's reply as its
   * answer. It is stored on the message rather than on the conversation, which means a turn
   * that RESOLVES the assembly simply carries none and nothing has to be cleared: the intent
   * dies with the turn that stopped asking.
   *
   * The question the client actually saw is stamped onto it here rather than trusted from the
   * model, because `cannot()` above is what put those words on the screen and the two must be
   * the same sentence. And the slot just asked about joins `asked`, which is what stops the
   * second question about a thing the client has already declined to specify — the loop that
   * turns a conversation into a form.
   */
  const asking = tasks.find((t) => t.action === 'clarify' && t.intent) ?? null;
  const pendingIntent: PendingIntent | null = asking?.intent
    ? { ...asking.intent, ...(asking.question ? { question: asking.question } : {}) }
    : null;

  /**
   * ── THE CAP IS RAISED BEFORE THE WORK, NOT AFTER IT (X2a) ────────────────────────────
   *
   * Found live: a request that exceeded the monthly allowance produced posts that were REFUSED
   * at apply time, stored an honest message nobody surfaced, and rendered as "On its way". The
   * client learned about the cap by watching nothing happen.
   *
   * So the turn says it here, while there is still a decision to make. Three facts and an
   * offer: how many changes this needs, how many are left, when more arrive, and that we can
   * hold the whole thing and run it then (`capAnnouncement`).
   *
   * WHICH CHANGES COST. The cap governs the EXPENSIVE path — a Bedrock call through the
   * planning-critic / planning-repair loop. An add is a caption written; a rewrite and a refine
   * are the same loop over an existing field; a hook is a generation. A MOVE, a DELETE and a
   * FORMAT CHANGE are structural writes with no model in them, and have always been free.
   *
   * It is an ANNOUNCEMENT, not a gate. The proposals are already made and the client can still
   * apply them; what happens then is the honest banked state (X2b/c) rather than a surprise.
   * That is also why a failed usage read is swallowed: a cost line that cannot be computed must
   * never change what the client is allowed to ask for.
   */
  const EXPENSIVE: ReadonlySet<string> = new Set(['add', 'rewrite', 'refine', 'hook']);
  const needed = items.filter((i) => i.kind === 'change' && EXPENSIVE.has(i.action)).length;
  let capNotice: CapNotice | null = null;
  if (needed > 0) {
    try {
      const usage = await getUsageForCycle(clientId, cycleId);
      const remaining = remainingAiChanges(usage);
      if (!usage.unlimited && needed > remaining) {
        capNotice = { needed, remaining, limit: usage.limit, resetsOn: usage.resetsOn };
        replyParts.push(capAnnouncement({ needed, remaining, resetsOn: usage.resetsOn }));
      }
    } catch { /* the cap is a sentence, not a gate — an unreadable allowance changes nothing */ }
  }

  const message = replyParts.join('\n') || (proposals.length ? '' : 'Okay.');
  const resp: AgentTurnResponse = {
    conversationId: convId, message, proposals, items,
    changeSetId: proposals.length ? changeSetId : null,
    ...(superseded.length ? { supersededProposalIds: superseded } : {}),
    ...(capNotice ? { capNotice } : {}),
  };

  /** The turn's outcome, as data (0092). Computed here, from what actually happened, and stored
   *  on the row beside the prose rather than inferable from it. */
  const outcome = turnOutcome({ thrown, queryOutcome, proposals: proposals.length, noted: notedSomething, items });
  await appendMessage({
    conversationId: convId, role: 'assistant',
    writer: 'plan-agent',
    outcome,
    // The CHECK constraint pins these two together: an error always names itself, and a
    // non-error can never carry a kind.
    errorKind: outcome === 'errored' ? thrown : null,
    content: message || `Proposed ${proposals.length} change${proposals.length === 1 ? '' : 's'} for review.`,
    // `items` persists ON the turn so the thread can re-render its interpretation across a
    // reopen (the sheet reads it back through listTurns) and so the NEXT turn's parser window
    // can serialise what this one resolved — "move it back" grips the resolved dates here.
    metadata: {
      tasks: tasks.map((t) => t.action), changeSetId: resp.changeSetId,
      proposalIds: proposals.map((p) => p.id), items,
      // The assembly, if this turn is still holding one (G1). Absent on every turn that isn't.
      ...(pendingIntent ? { pendingIntent } : {}),
      // The cap announcement, so a reopened thread renders the same turn it showed live (X2a).
      ...(capNotice ? { capNotice } : {}),
    },
  });

  return resp;
}
