/**
 * agent/proposals.ts — proposal lifecycle + apply.
 *
 * EVERY mutating action (move/delete/rewrite/add) is a pending proposal; nothing
 * applies at parse time. Approval applies deterministically for move/delete/add
 * (patchPost/softDeletePost/addGeneratingPost — client+cycle scoped per commit 33f658f) and
 * enqueues the existing quota'd, validated BullMQ shape job for rewrite. Apply is
 * gated by a conditional status transition (only 'pending' proceeds), so a
 * double-approve never double-applies.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, agentProposals, contentCycles, contentCyclePosts, planActivity, hasRealCaption } from '@sprigly/db';
import type { AgentProposalRow } from '@sprigly/db';
import { patchPost, softDeletePost, addGeneratedPost, addGeneratingPost } from '../mutations';
import type { ActivityActor } from '../activity';
import { enqueueShape, enqueueHookJob, enqueueScriptJob } from '../queue';

/** Matches the interactive default and script-ready.ts's fan-out default. */
const DEFAULT_SCRIPT_SECONDS = 30;
import { getUsageForCycle, isRewriteBlocked } from '../usage';
import { startPostGeneration, enqueueFollowOnGeneration, defaultCaptionBrief } from '../post-generation';
import { resolvePostForEdit, isEditableDate, canAddPost, editScopeToday, landsInDraftMonth } from '../edit-scope';
import { markNoteIntegrated } from './notes';
import type { MutatingAction, ProposalPayload, ProposalView } from './types';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
/** 'YYYY-MM-DD' → '31 October', for a refusal that names the date it is about. */
function dayMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1] ?? ''}`.trim() : iso;
}

/** 'YYYY-MM-DD' → 'October 2026' — a refusal about a whole MONTH names the month, not a day. */
function monthName(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1] ?? iso} ${m[1]}` : iso;
}

/**
 * The date refusal, in words the client can act on.
 *
 * An ADD names the date it was refused for, because that date is the only thing wrong with it
 * and naming it is what makes "amend it" a next step rather than a guess. Everything else is
 * about an existing post, whose date the client can see.
 */
function dateRefusal(p: ProposalPayload): string {
  if (p.kind === 'add' || p.kind === 'add_generated') {
    return `${dayMonth(p.date)} has already passed, so I couldn’t add it there.`;
  }
  if (p.kind === 'move') {
    return `${dayMonth(p.toDate)} has already passed, so I couldn’t move it there.`;
  }
  return 'That post is in the past — it’s read-only now.';
}

/** DATE POLICY for agent actions: a post is editable iff dated today-onward (London).
 *  Agent rewrite/hook/refine enqueue jobs DIRECTLY (bypassing the date-gated routes),
 *  so every approve path re-checks here. */
async function agentPostEditable(clientId: string, postId: string, today: string): Promise<boolean> {
  const ctx = await resolvePostForEdit(clientId, postId);
  return !!ctx && isEditableDate(ctx.scheduledDate, today);
}

const view = (r: Pick<AgentProposalRow, 'id' | 'intent' | 'summary' | 'status' | 'changeSetId'>): ProposalView =>
  ({ id: r.id, intent: r.intent, summary: r.summary, status: r.status, changeSetId: r.changeSetId ?? null });

const cols = {
  id: agentProposals.id, intent: agentProposals.intent, summary: agentProposals.summary,
  status: agentProposals.status, changeSetId: agentProposals.changeSetId,
};

export interface CreateProposalArgs {
  clientId: string;
  conversationId: string;
  messageId: string;
  changeSetId: string;
  action: MutatingAction;
  payload: ProposalPayload;
  summary: string;
}

export async function createProposal(args: CreateProposalArgs): Promise<ProposalView> {
  const [row] = await db
    .insert(agentProposals)
    .values({
      clientId: args.clientId,
      conversationId: args.conversationId,
      messageId: args.messageId,
      changeSetId: args.changeSetId,
      intent: args.action,
      payload: args.payload as unknown as Record<string, unknown>,
      summary: args.summary,
    })
    .returning(cols);
  return view(row!);
}

/** Pending proposals for a client, newest first. Client-scoped. */
export async function listPendingProposals(clientId: string): Promise<ProposalView[]> {
  const rows = await db
    .select(cols)
    .from(agentProposals)
    .where(and(eq(agentProposals.clientId, clientId), eq(agentProposals.status, 'pending')))
    .orderBy(desc(agentProposals.createdAt));
  return rows.map(view);
}

/**
 * The still-PENDING subset of some ids, with their payloads — the referent an ambiguous
 * correction amends (C3). Only pending rows come back: a proposal the client already applied
 * or discarded is not what they are looking at, whatever the sheet last knew.
 */
export async function loadPendingPayloads(
  clientId: string, ids: readonly string[],
): Promise<Array<{ id: string; intent: string; summary: string; payload: ProposalPayload }>> {
  if (!ids.length) return [];
  const rows = await db
    .select({ id: agentProposals.id, intent: agentProposals.intent, summary: agentProposals.summary, payload: agentProposals.payload, status: agentProposals.status })
    .from(agentProposals)
    .where(and(eq(agentProposals.clientId, clientId), eq(agentProposals.status, 'pending')));
  const wanted = new Set(ids);
  return rows
    .filter((r) => wanted.has(r.id))
    .map((r) => ({ id: r.id, intent: r.intent, summary: r.summary, payload: r.payload as unknown as ProposalPayload }));
}

/**
 * One proposal's payload, WHATEVER its status — the refused one included.
 *
 * `loadPendingPayloads` deliberately serves only pending rows, because the C3 referent is what
 * the client is looking at. The rescue (G3) needs the opposite: a change that a guard has
 * already consumed, so its date can be amended and it can be built again. Client-scoped, and it
 * returns the payload only — nothing here decides what to do with it.
 */
export async function loadProposalPayload(
  clientId: string, id: string,
): Promise<{ intent: string; summary: string; status: string; payload: ProposalPayload } | null> {
  const [row] = await db
    .select({ intent: agentProposals.intent, summary: agentProposals.summary, status: agentProposals.status, payload: agentProposals.payload })
    .from(agentProposals)
    .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId)))
    .limit(1);
  return row ? { ...row, payload: row.payload as unknown as ProposalPayload } : null;
}

async function currentView(clientId: string, id: string): Promise<ProposalView | null> {
  const [row] = await db
    .select(cols)
    .from(agentProposals)
    .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId)))
    .limit(1);
  return row ? view(row) : null;
}

async function setStatus(clientId: string, id: string, status: string, error: string | null, applied: boolean): Promise<void> {
  await db
    .update(agentProposals)
    .set({ status, error, ...(applied ? { appliedAt: new Date() } : {}) })
    .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId)));
}

async function cycleChannel(clientId: string, cycleId: string): Promise<string> {
  const [row] = await db
    .select({ channel: contentCycles.channel })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
    .limit(1);
  return row?.channel ?? 'instagram';
}

export interface ApproveResult {
  proposal: ProposalView | null;
  jobId?: string;
  // generate_hook: the post whose hooks were enqueued, so the client can poll the hook
  // job and surface the candidates in that post's hook UI (as a manual generate does).
  hookPostId?: string;
  // A dependency-not-met / not-applicable outcome that did NOT consume the proposal (it
  // stays pending/approvable) — the client shows `message` and keeps the row actionable.
  blocked?: boolean;
  /**
   * WHY IT DIDN'T APPLY — and it is REQUIRED on every refusal, not decoration.
   *
   * ── The vanished launch post (G3) ────────────────────────────────────────────────────
   *
   * Every guard here used to write its reason to the ROW (`setStatus(…, 'failed', reason)`)
   * and return `{ proposal }` with nothing else. The reason went into the database and
   * stopped there: the route forwarded only `message`, which was absent, so the client got a
   * 200 carrying `status:'failed'` and no words at all. `usePlanData.decide` then read the
   * HTTP status, saw 200, and counted the refusal as APPLIED — which is how a launch arc
   * came back "Done — 3 changes are in" with two posts on the calendar.
   *
   * So a refusal now says so in the response as well as in the row, and `failed` marks it
   * explicitly rather than leaving the caller to infer it from a status string.
   */
  message?: string;
  /** The guard consumed the proposal and refused it. Distinct from `blocked`, which did not
   *  consume it: a blocked change is still there to approve, a failed one is not. */
  failed?: boolean;
  /** The post(s) this approval touched or created — what the surface highlights in the
   *  what-changed treatment after a background apply (F4). Absent on blocked/failed. */
  changedPostIds?: string[];
}

/** The post created by approving a given add proposal (its post_created ledger row carries
 *  refProposalId). Used to resolve a generate_hook that targets a post created earlier in
 *  the same ask. */
async function postCreatedByProposal(clientId: string, proposalId: string): Promise<string | null> {
  const [row] = await db
    .select({ postId: planActivity.postId })
    .from(planActivity)
    .where(and(eq(planActivity.clientId, clientId), eq(planActivity.refProposalId, proposalId), eq(planActivity.action, 'post_created')))
    .orderBy(desc(planActivity.createdAt))
    .limit(1);
  return row?.postId ?? null;
}

/** Resolve a generate_hook payload to a ready reel/carousel post, or a not-ready reason.
 *  `ready:false` is a GRACEFUL block (ordering not yet satisfied / wrong format / gone) —
 *  the caller must NOT consume the proposal so it stays approvable. */
async function resolveHookTarget(
  clientId: string,
  p: Extract<ProposalPayload, { kind: 'generate_hook' }>,
): Promise<{ ready: true; postId: string; format: string; scriptLengthSeconds: number | null; hasCaption: boolean } | { ready: false; message: string }> {
  let postId = p.postId ?? null;
  if (!postId && p.refProposalId) {
    postId = await postCreatedByProposal(clientId, p.refProposalId);
    if (!postId) return { ready: false, message: 'Approve the “Add …” step first, then approve this one to generate its hooks.' };
  }
  if (!postId) return { ready: false, message: 'I couldn’t find the post to generate hooks for.' };
  const [post] = await db
    .select({
      format: contentCyclePosts.format, deletedAt: contentCyclePosts.deletedAt,
      caption: contentCyclePosts.caption, scriptLengthSeconds: contentCyclePosts.scriptLengthSeconds,
    })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.id, postId), eq(contentCyclePosts.clientId, clientId), eq(contentCyclePosts.cycleId, p.cycleId)))
    .limit(1);
  if (!post || post.deletedAt) return { ready: false, message: 'That post no longer exists.' };
  if (post.format !== 'reel' && post.format !== 'carousel') {
    return { ready: false, message: 'Hooks apply to reels and carousels. Change the format first, then generate hooks.' };
  }
  return {
    ready: true, postId, format: post.format,
    scriptLengthSeconds: post.scriptLengthSeconds ?? null,
    hasCaption: hasRealCaption(post.caption),
  };
}

/** Resolve a refine payload to a post whose target field EXISTS (non-empty). `ready:false`
 *  is a graceful block (ordering not met / wrong format / empty field → offer generation) —
 *  the caller must NOT consume the proposal so it stays approvable. */
async function resolveRefineTarget(
  clientId: string,
  p: Extract<ProposalPayload, { kind: 'refine' }>,
): Promise<{ ready: true; postId: string } | { ready: false; message: string }> {
  let postId = p.postId ?? null;
  if (!postId && p.refProposalId) {
    postId = await postCreatedByProposal(clientId, p.refProposalId);
    if (!postId) return { ready: false, message: 'Approve the earlier step first, then approve this one to refine it.' };
  }
  if (!postId) return { ready: false, message: 'I couldn’t find the post to refine.' };
  const [post] = await db
    .select({ format: contentCyclePosts.format, hook: contentCyclePosts.hook, script: contentCyclePosts.script, deletedAt: contentCyclePosts.deletedAt })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.id, postId), eq(contentCyclePosts.clientId, clientId), eq(contentCyclePosts.cycleId, p.cycleId)))
    .limit(1);
  if (!post || post.deletedAt) return { ready: false, message: 'That post no longer exists.' };
  if (p.target === 'hook') {
    if (post.format !== 'reel' && post.format !== 'carousel') return { ready: false, message: 'Hooks apply to reels and carousels.' };
    if (!post.hook || !post.hook.trim()) return { ready: false, message: 'There’s no hook on that post yet. Want me to generate one first?' };
  } else {
    if (post.format !== 'reel') return { ready: false, message: 'Scripts apply to reels.' };
    if (!post.script || !post.script.trim()) return { ready: false, message: 'There’s no script on that post yet. Want me to generate one first?' };
  }
  return { ready: true, postId };
}

/**
 * Approve + apply a proposal, idempotently. The conditional transition
 * (WHERE status='pending') is the concurrency gate — only one caller applies. A
 * rewrite enqueues the quota'd shape job (returns a jobId to poll); move/delete/add
 * apply through the existing deterministic mutations.
 */
export async function approveProposal(clientId: string, id: string, resolvedBy: string): Promise<ApproveResult> {
  const claimed = await db
    .update(agentProposals)
    .set({ status: 'approved', resolvedAt: new Date(), resolvedBy })
    .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId), eq(agentProposals.status, 'pending')))
    .returning();
  const row = claimed[0];
  if (!row) return { proposal: await currentView(clientId, id) }; // already resolved / not owned

  const payload = row.payload as unknown as ProposalPayload;
  let genJobId: string | undefined;   // add-with-instruction: the caption-generation job to poll
  // The post(s) this approval touches/creates — reported back so the surface can run the
  // what-changed treatment (chip + highlights) after a background apply (F4).
  let changedPostIds: string[] = [];
  // Approved agent changes land in the plan_activity ledger as origin='agent', tagged
  // with this proposal id — one ordered stream with the user's direct edits (AUDIT §3).
  // origin 'agent', actor 'client'. The two disagree here on purpose: the agent composed the
  // change, and the client asked for it — this code path only runs because a client pressed
  // approve. For the untouched-post rate that is unambiguously a touch.
  const agentActor: ActivityActor = { origin: 'agent', actor: 'client', refProposalId: id };
  // DATE POLICY: refuse any agent action on a post/date before today (London).
  const today = editScopeToday();
  /** ONE refusal shape. The reason goes to the row AND to the caller — see `message` above. */
  const refuse = async (reason: string): Promise<ApproveResult> => {
    await setStatus(clientId, id, 'failed', reason, false);
    return { proposal: view({ ...row, status: 'failed' }), failed: true, message: reason };
  };
  const readOnlyFail = () => refuse(dateRefusal(payload));
  /**
   * THE DRAFT FENCE, RE-CHECKED AT APPLY.
   *
   * `turn.ts` refuses these at PROPOSAL time, which is where the client reads it. This is the
   * second check, and it is not redundant: a proposal is a stored row a client can approve at
   * any later moment, and the month it targets can have entered draft since — a re-assembly, a
   * new cycle drafted — between the proposal and the tap. `mutations.ts` would then refuse with
   * a bare null that this file reports as `readOnlyFail()`, i.e. "that date has already passed",
   * which would be false. Named here so the refusal is true.
   */
  const draftFail = async (cycleId: string | null, date: string | null): Promise<ApproveResult | null> => {
    if (!(await landsInDraftMonth(row.clientId, cycleId, date))) return null;
    return refuse(`${date ? monthName(date) : 'that month'} is still a draft you haven’t approved — changes to it happen on the draft itself.`);
  };
  try {
    if (payload.kind === 'rewrite') {
      if (!(await agentPostEditable(row.clientId, payload.postId, today))) return readOnlyFail();
      const usage = await getUsageForCycle(row.clientId, payload.cycleId);
      if (isRewriteBlocked(usage)) return refuse(`you’ve used all ${usage.limit} AI changes this month.`);
      const r = await enqueueShape({ type: 'shape', scope: 'post', clientId: row.clientId, cycleId: payload.cycleId, targetPostId: payload.postId, instruction: payload.instruction, source: 'web', proposalId: id, actor: 'client' });
      if ('error' in r) throw new Error(r.error);
      await setStatus(clientId, id, 'applied', null, true);
      return { proposal: view({ ...row, status: 'applied' }), jobId: r.jobId, changedPostIds: [payload.postId] };
    }

    if (payload.kind === 'move') {
      // Both ends must be today-onward: can't move a past post, nor INTO the past. Which end
      // failed is the difference between "pick another date" and "that one is done" — so the
      // refusal says which rather than making the client work it out.
      if (!isEditableDate(payload.toDate, today)) return refuse(dateRefusal(payload));
      if (!(await agentPostEditable(row.clientId, payload.postId, today))) {
        return refuse('That post is in the past — it’s read-only now.');
      }
      const moveIntoDraft = await draftFail(null, payload.toDate);
      if (moveIntoDraft) return moveIntoDraft;
      await patchPost(row.clientId, payload.cycleId, payload.postId, { date: payload.toDate }, agentActor, today);
      changedPostIds = [payload.postId];
    } else if (payload.kind === 'delete') {
      if (!(await agentPostEditable(row.clientId, payload.postId, today))) return readOnlyFail();
      await softDeletePost(row.clientId, payload.cycleId, payload.postId, agentActor, today);
      // Deliberately NOT reported as changed: the row is gone, so there is no card to highlight.
    } else if (payload.kind === 'format') {
      // Apply the format change (format_changed ledger, origin agent). The checklist
      // reconcile is left to the editor's keep/replace flow — approving a format change
      // never silently discards checklist progress.
      if (!(await agentPostEditable(row.clientId, payload.postId, today))) return readOnlyFail();
      await patchPost(row.clientId, payload.cycleId, payload.postId, { format: payload.format }, agentActor, today);
      changedPostIds = [payload.postId];
    } else if (payload.kind === 'add') {
      if (!canAddPost(payload.date, today)) return readOnlyFail();   // ADD POLICY: see canAddPost
      const addIntoDraft = await draftFail(payload.cycleId, payload.date);
      if (addIntoDraft) return addIntoDraft;
      const channel = payload.channel ?? await cycleChannel(row.clientId, payload.cycleId);
      const format = payload.format ?? 'single';   // the inferred (or defaulted) format
      /**
       * ── THE ENQUEUE GAP (X4) ───────────────────────────────────────────────────────
       *
       * This branched. WITH an instruction the post was inserted as `generating` and a shape
       * job wrote its caption; WITHOUT one it fell to `addDraft` — status 'new', the
       * scaffolding placeholder in the caption column, and NOTHING enqueued, ever.
       *
       * That second post is unrecoverable by design rather than by accident. `isOnTheWay`
       * is false for 'new', so it does not even read as in flight; the failed-generation
       * sweep only looks at 'generation_failed'; and the status counts cannot tell it apart
       * from a post whose generation SUCCEEDED, because a successful generation also
       * resolves to 'new' (engine/shape.ts). So it sits on the calendar, empty, forever,
       * and nothing anywhere is looking for it.
       *
       * `/api/posts` closed exactly this hole for the client's own add slot and said so in
       * its own comment — "CAPTION GENERATION ENQUEUES REGARDLESS; AN INSTRUCTION ONLY
       * STEERS IT". The agent's add path was simply left behind. There is one path now, and
       * `defaultCaptionBrief` is shared with that route so the neutral brief is one wording.
       */
      const instruction = payload.instruction?.trim() || defaultCaptionBrief(payload.date, format);
      // The title the client's own words gave it (X3) — carried on the payload since the turn
      // that proposed it, so the row is headed with the line they read on the interpretation.
      const created = await addGeneratingPost(row.clientId, payload.cycleId, { channel, date: payload.date, instruction, format, title: payload.title ?? null }, agentActor, today);
      if (!created) return readOnlyFail();
      // Quota-block or enqueue failure leaves the post in a failed state (not the default
      // placeholder) — the approval still succeeds because the post exists and the reason is
      // on the row. Insert THEN enqueue, in that order: a post marked generating with nothing
      // enqueued is the stuck state the sweep exists to prevent, and the reverse ordering
      // would create it on every failed insert.
      const gen = await startPostGeneration(row.clientId, payload.cycleId, created.postId, instruction, today);
      if ('jobId' in gen) genJobId = gen.jobId;
      // THE FULL GENERATION (F5): an added carousel gets its hook enqueued alongside the
      // caption (autoSelect, phase2's own reasoning). An added reel needs nothing here —
      // the worker enqueues its combined hook+script the moment the caption lands
      // (consumer.ts → enqueueScriptIfReady), and that chain covers this path already.
      await enqueueFollowOnGeneration(row.clientId, payload.cycleId, created.postId, format);
      changedPostIds = [created.postId];
    } else if (payload.kind === 'generate_hook') {
      // Resolve the target (existing reel/carousel, or the post created by the referenced
      // add proposal). If it isn't ready (the create step hasn't been approved yet), this is
      // NOT a failure — UN-CLAIM the proposal so it stays approvable, and return a graceful
      // message so the client can approve the create step first, then this one.
      const target = await resolveHookTarget(row.clientId, payload);
      if (!target.ready) {
        await db.update(agentProposals)
          .set({ status: 'pending', resolvedAt: null, resolvedBy: null, error: null, appliedAt: null })
          .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId)));
        return { proposal: view({ ...row, status: 'pending' }), blocked: true, message: target.message };
      }
      if (!(await agentPostEditable(row.clientId, target.postId, today))) return readOnlyFail();
      // Counts against the AI-change cap like a rewrite (it's an AI generation).
      const usage = await getUsageForCycle(row.clientId, payload.cycleId);
      if (isRewriteBlocked(usage)) return refuse(`you’ve used all ${usage.limit} AI changes this month.`);
      // A REEL takes the COMBINED hook+script job (C4). This was the agent's own solo-hook
      // route — the second of the two that could weld a mismatched hook onto a reel, and the
      // one reachable by simply asking for hooks out loud. Not ready without a caption: both
      // fields are written FROM it, and nothing here writes one first.
      if (target.format === 'reel') {
        if (!target.hasCaption) {
          await db.update(agentProposals)
            .set({ status: 'pending', resolvedAt: null, resolvedBy: null, error: null, appliedAt: null })
            .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId)));
          return {
            proposal: view({ ...row, status: 'pending' }), blocked: true,
            message: 'A reel’s hook and script are written together, from its caption — so the caption has to land first.',
          };
        }
        const combined = await enqueueScriptJob({
          type: 'script', clientId: row.clientId, cycleId: payload.cycleId, targetPostId: target.postId,
          lengthSeconds: target.scriptLengthSeconds ?? DEFAULT_SCRIPT_SECONDS,
        });
        if ('error' in combined) throw new Error(combined.error);
        await setStatus(clientId, id, 'applied', null, true);
        // No `hookPostId`: the combined job WRITES both fields onto the post rather than
        // returning candidates to pick, so the client polls it like a script job.
        return { proposal: view({ ...row, status: 'applied' }), jobId: combined.jobId, changedPostIds: [target.postId] };
      }
      const r = await enqueueHookJob({ type: 'hook', clientId: row.clientId, cycleId: payload.cycleId, targetPostId: target.postId });
      if ('error' in r) throw new Error(r.error);
      await setStatus(clientId, id, 'applied', null, true);
      return { proposal: view({ ...row, status: 'applied' }), jobId: r.jobId, hookPostId: target.postId, changedPostIds: [target.postId] };
    } else if (payload.kind === 'refine') {
      // Refine an existing hook/script via the target-aware shape job (§26). Not-ready (the
      // field doesn't exist yet / create step unapproved) un-claims → stays approvable.
      const target = await resolveRefineTarget(row.clientId, payload);
      if (!target.ready) {
        await db.update(agentProposals)
          .set({ status: 'pending', resolvedAt: null, resolvedBy: null, error: null, appliedAt: null })
          .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId)));
        return { proposal: view({ ...row, status: 'pending' }), blocked: true, message: target.message };
      }
      if (!(await agentPostEditable(row.clientId, target.postId, today))) return readOnlyFail();
      const usage = await getUsageForCycle(row.clientId, payload.cycleId);
      if (isRewriteBlocked(usage)) return refuse(`you’ve used all ${usage.limit} AI changes this month.`);
      const r = await enqueueShape({ type: 'shape', scope: 'post', clientId: row.clientId, cycleId: payload.cycleId, targetPostId: target.postId, instruction: payload.instruction, target: payload.target, source: 'web', proposalId: id, actor: 'client' });
      if ('error' in r) throw new Error(r.error);
      await setStatus(clientId, id, 'applied', null, true);
      return { proposal: view({ ...row, status: 'applied' }), jobId: r.jobId, changedPostIds: [target.postId] };
    } else if (payload.kind === 'apply_caption') {
      // Weekly-session pre-generated rewrite: apply the already-validated caption
      // deterministically (no second generation), and mark any integrated note.
      if (!(await agentPostEditable(row.clientId, payload.postId, today))) return readOnlyFail();
      await patchPost(row.clientId, payload.cycleId, payload.postId, { caption: payload.caption }, agentActor, today);
      if (payload.noteId) await markNoteIntegrated(row.clientId, payload.noteId, id);
      changedPostIds = [payload.postId];
    } else if (payload.kind === 'add_generated') {
      if (!canAddPost(payload.date, today)) return readOnlyFail();   // ADD POLICY: see canAddPost
      const genIntoDraft = await draftFail(payload.cycleId, payload.date);
      if (genIntoDraft) return genIntoDraft;
      const added = await addGeneratedPost(row.clientId, payload.cycleId, { channel: payload.channel, date: payload.date, format: payload.format, pillar: payload.pillar, caption: payload.caption }, agentActor, today);
      if (added?.mode === 'applied') changedPostIds = added.changedPostIds;
    }
    await setStatus(clientId, id, 'applied', null, true);
    return { proposal: view({ ...row, status: 'applied' }), ...(genJobId ? { jobId: genJobId } : {}), ...(changedPostIds.length ? { changedPostIds } : {}) };
  } catch (err) {
    // The raw error is the ROW's business (an operator reads it); the client gets a sentence.
    // What matters is that this path, like every other refusal, now REPORTS rather than
    // returning a bare failed proposal the caller counts as applied.
    await setStatus(clientId, id, 'failed', String(err), false);
    return { proposal: view({ ...row, status: 'failed' }), failed: true, message: 'something went wrong applying it.' };
  }
}

/** Reject a pending proposal. Idempotent — a non-pending proposal returns current. */
export async function rejectProposal(clientId: string, id: string, resolvedBy: string): Promise<ProposalView | null> {
  const rejected = await db
    .update(agentProposals)
    .set({ status: 'rejected', resolvedAt: new Date(), resolvedBy })
    .where(and(eq(agentProposals.id, id), eq(agentProposals.clientId, clientId), eq(agentProposals.status, 'pending')))
    .returning(cols);
  const row = rejected[0];
  return row ? view(row) : currentView(clientId, id);
}
