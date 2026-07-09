/**
 * agent/proposals.ts — proposal lifecycle + apply.
 *
 * EVERY mutating action (move/delete/rewrite/add) is a pending proposal; nothing
 * applies at parse time. Approval applies deterministically for move/delete/add
 * (patchPost/softDeletePost/addDraft — client+cycle scoped per commit 33f658f) and
 * enqueues the existing quota'd, validated BullMQ shape job for rewrite. Apply is
 * gated by a conditional status transition (only 'pending' proceeds), so a
 * double-approve never double-applies.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, agentProposals, contentCycles, contentCyclePosts, planActivity } from '@sprigly/db';
import type { AgentProposalRow } from '@sprigly/db';
import { patchPost, softDeletePost, addDraft, addGeneratedPost, addGeneratingPost } from '../mutations';
import type { ActivityActor } from '../activity';
import { enqueueShape, enqueueHookJob } from '../queue';
import { getUsageForCycle, isRewriteBlocked } from '../usage';
import { startPostGeneration } from '../post-generation';
import { markNoteIntegrated } from './notes';
import type { MutatingAction, ProposalPayload, ProposalView } from './types';

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
  message?: string;
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
): Promise<{ ready: true; postId: string } | { ready: false; message: string }> {
  let postId = p.postId ?? null;
  if (!postId && p.refProposalId) {
    postId = await postCreatedByProposal(clientId, p.refProposalId);
    if (!postId) return { ready: false, message: 'Approve the “Add …” step first, then approve this one to generate its hooks.' };
  }
  if (!postId) return { ready: false, message: 'I couldn’t find the post to generate hooks for.' };
  const [post] = await db
    .select({ format: contentCyclePosts.format, deletedAt: contentCyclePosts.deletedAt })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.id, postId), eq(contentCyclePosts.clientId, clientId), eq(contentCyclePosts.cycleId, p.cycleId)))
    .limit(1);
  if (!post || post.deletedAt) return { ready: false, message: 'That post no longer exists.' };
  if (post.format !== 'reel' && post.format !== 'carousel') {
    return { ready: false, message: 'Hooks apply to reels and carousels — change the format first, then generate hooks.' };
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
  // Approved agent changes land in the plan_activity ledger as origin='agent', tagged
  // with this proposal id — one ordered stream with the user's direct edits (AUDIT §3).
  const agentActor: ActivityActor = { origin: 'agent', refProposalId: id };
  try {
    if (payload.kind === 'rewrite') {
      const usage = await getUsageForCycle(row.clientId, payload.cycleId);
      if (isRewriteBlocked(usage)) {
        await setStatus(clientId, id, 'failed', `You’ve used all ${usage.limit} AI changes this month.`, false);
        return { proposal: view({ ...row, status: 'failed' }) };
      }
      const r = await enqueueShape({ type: 'shape', scope: 'post', clientId: row.clientId, cycleId: payload.cycleId, targetPostId: payload.postId, instruction: payload.instruction, source: 'web', proposalId: id });
      if ('error' in r) throw new Error(r.error);
      await setStatus(clientId, id, 'applied', null, true);
      return { proposal: view({ ...row, status: 'applied' }), jobId: r.jobId };
    }

    if (payload.kind === 'move') {
      await patchPost(row.clientId, payload.cycleId, payload.postId, { date: payload.toDate }, agentActor);
    } else if (payload.kind === 'delete') {
      await softDeletePost(row.clientId, payload.cycleId, payload.postId, agentActor);
    } else if (payload.kind === 'format') {
      // Apply the format change (format_changed ledger, origin agent). The checklist
      // reconcile is left to the editor's keep/replace flow — approving a format change
      // never silently discards checklist progress.
      await patchPost(row.clientId, payload.cycleId, payload.postId, { format: payload.format }, agentActor);
    } else if (payload.kind === 'add') {
      const channel = payload.channel ?? await cycleChannel(row.clientId, payload.cycleId);
      const format = payload.format ?? 'single';   // the inferred (or defaulted) format
      const instruction = payload.instruction?.trim();
      if (instruction) {
        // Add-with-instruction: insert the post NOW so it takes its slot, then
        // generate the caption async. Quota is checked/counted by the shape job.
        // Quota-block or enqueue failure leaves the post in a failed state (not the
        // default placeholder) — the approval still succeeds because the post exists.
        const { postId } = await addGeneratingPost(row.clientId, payload.cycleId, { channel, date: payload.date, instruction, format }, agentActor);
        const gen = await startPostGeneration(row.clientId, payload.cycleId, postId, instruction);
        if ('jobId' in gen) genJobId = gen.jobId;
      } else {
        await addDraft(row.clientId, payload.cycleId, channel, payload.date, agentActor, format);
      }
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
      // Counts against the AI-change cap like a rewrite (it's an AI generation).
      const usage = await getUsageForCycle(row.clientId, payload.cycleId);
      if (isRewriteBlocked(usage)) {
        await setStatus(clientId, id, 'failed', `You’ve used all ${usage.limit} AI changes this month.`, false);
        return { proposal: view({ ...row, status: 'failed' }) };
      }
      const r = await enqueueHookJob({ type: 'hook', clientId: row.clientId, cycleId: payload.cycleId, targetPostId: target.postId });
      if ('error' in r) throw new Error(r.error);
      await setStatus(clientId, id, 'applied', null, true);
      return { proposal: view({ ...row, status: 'applied' }), jobId: r.jobId, hookPostId: target.postId };
    } else if (payload.kind === 'apply_caption') {
      // Weekly-session pre-generated rewrite: apply the already-validated caption
      // deterministically (no second generation), and mark any integrated note.
      await patchPost(row.clientId, payload.cycleId, payload.postId, { caption: payload.caption }, agentActor);
      if (payload.noteId) await markNoteIntegrated(row.clientId, payload.noteId, id);
    } else if (payload.kind === 'add_generated') {
      await addGeneratedPost(row.clientId, payload.cycleId, { channel: payload.channel, date: payload.date, format: payload.format, pillar: payload.pillar, caption: payload.caption }, agentActor);
    }
    await setStatus(clientId, id, 'applied', null, true);
    return { proposal: view({ ...row, status: 'applied' }), ...(genJobId ? { jobId: genJobId } : {}) };
  } catch (err) {
    await setStatus(clientId, id, 'failed', String(err), false);
    return { proposal: view({ ...row, status: 'failed' }) };
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
