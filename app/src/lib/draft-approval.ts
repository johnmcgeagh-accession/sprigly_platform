/**
 * draft-approval.ts — the moment a proposal becomes a commitment.
 *
 * Approval flips every draft beat to `'generating'` and hands them to phase 2, which spends
 * real money writing captions, hooks and scripts. So it is deliberately the narrowest door
 * in the whole arc: one function, two guards, one atomic write, and it is the ONLY writer
 * anywhere that changes a draft row's status.
 *
 * ── Why 'generating' ─────────────────────────────────────────────────────────
 * Not a status invented for this build. It is the status the shipped generation path
 * already expects, and the citation chain is exact:
 *   app/src/lib/mutations.ts:203      addGeneratingPost inserts status:'generating'
 *   engine/…/shape.ts:111             isGenerating = post.status === 'generating'
 *   engine/…/shape.ts:140             on success  → status: isGenerating ? 'new' : 'edited'
 *   engine/…/shape.ts:175             on failure  → status: 'generation_failed'
 * So an approved beat enters the same lifecycle a client-added post has always used, and
 * resolves to 'new' or 'generation_failed' by the same code. Phase 2 needed no new states.
 *
 * ── Why structure is safe ────────────────────────────────────────────────────
 * shape.ts writes ONLY caption + status. Structure survives because regeneratePost merges
 * the input row's structural fields over the model's output (613030e) — enforced in code,
 * not requested in a prompt. That is what makes "beats are fixed structure" a guarantee.
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db, contentCycles, contentCyclePosts, POST_STATUS_DRAFT, PRE_PLANNING_STATUSES } from '@sprigly/db';

/** The status an approved beat takes. See the citation chain above. */
export const POST_STATUS_GENERATING = 'generating' as const;

export type ApprovalError =
  | 'no_cycle'
  | 'no_draft'          // nothing to approve
  | 'mixed_state'       // committed posts already exist — this is not a draft month
  | 'already_approved'  // idempotency: a second press is not a second approval
  | 'cutoff_passed';    // manual approval only; the auto path bypasses this deliberately

export type ApprovalResult =
  | { ok: true; approved: number; postIds: string[] }
  | { ok: false; error: ApprovalError; message: string };

const MESSAGES: Record<ApprovalError, string> = {
  no_cycle:         'We couldn’t find that month.',
  no_draft:         'There’s no draft to approve.',
  mixed_state:      'This month already has a plan, so there’s nothing to approve.',
  already_approved: 'You’ve already approved this month — we’re writing it now.',
  cutoff_passed:    'This month has already gone ahead.',
};

const fail = (error: ApprovalError): ApprovalResult => ({ ok: false, error, message: MESSAGES[error] });

export interface ApproveParams {
  clientId: string;
  cycleId:  string;
  /**
   * D3: the cutoff arrived with the draft unapproved, so we go ahead on the client's
   * behalf. Skips the cutoff guard (being at cutoff is the whole trigger) and stamps
   * approved_by='auto' so the plan-ready email can say so rather than implying they chose.
   */
  auto?:    boolean;
  now?:     Date;
}

/**
 * Approve a cycle's draft.
 *
 * ATOMIC: every draft row transitions, or none does. A half-approved month would leave
 * some beats generating and some still draft, which no reader in the system is built to
 * make sense of — the surface would show a draft, the generation path would be writing
 * into it, and the client would see neither state honestly.
 *
 * IDEMPOTENT-BY-REJECTION on a second call, not silently repeated. Chosen over
 * "idempotent-by-no-op" because approval SPENDS MONEY: a double-press that quietly
 * returned success would be indistinguishable from a double fan-out, and the failure mode
 * of the wrong choice (paying twice, two captions racing into one row) is worse than the
 * failure mode of an explicit "already approved" message. The client is told plainly what
 * state they are in.
 */
export async function approveDraft(params: ApproveParams): Promise<ApprovalResult> {
  const { clientId, cycleId, auto = false } = params;
  const now = params.now ?? new Date();

  const [cycle] = await db
    .select({ id: contentCycles.id, status: contentCycles.status, approvedAt: contentCycles.approvedAt })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
    .limit(1);
  if (!cycle) return fail('no_cycle');
  if (cycle.approvedAt) return fail('already_approved');

  // Manual approval is a pre-cutoff right. The auto path deliberately bypasses this: it
  // fires AT cutoff, which would otherwise be exactly the moment it is refused.
  if (!auto && !PRE_PLANNING_STATUSES.has(cycle.status)) return fail('cutoff_passed');

  const drafts = await db
    .select({ id: contentCyclePosts.id })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
      isNull(contentCyclePosts.deletedAt),
    ));
  if (drafts.length === 0) return fail('no_draft');

  // Mixed state: committed posts already exist alongside the drafts. Approving would
  // produce a month that is half generated-from-beats and half whatever was there before,
  // and nothing downstream distinguishes them. Refuse rather than merge.
  const [committed] = await db
    .select({ id: contentCyclePosts.id })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
      ne(contentCyclePosts.status, POST_STATUS_DRAFT),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);
  if (committed) return fail('mixed_state');

  await db.transaction(async (tx) => {
    await tx.update(contentCyclePosts)
      .set({ status: POST_STATUS_GENERATING })
      .where(and(
        eq(contentCyclePosts.cycleId, cycleId),
        eq(contentCyclePosts.clientId, clientId),
        eq(contentCyclePosts.status, POST_STATUS_DRAFT),   // re-checked IN the write
        isNull(contentCyclePosts.deletedAt),
      ));
    await tx.update(contentCycles)
      .set({ approvedAt: now, approvedBy: auto ? 'auto' : 'client', updatedAt: now })
      .where(eq(contentCycles.id, cycleId));
  });

  return { ok: true, approved: drafts.length, postIds: drafts.map((d) => d.id) };
}

/** Has this cycle been approved? Drives the surface state and the draft-mutation guards. */
export async function cycleApproval(cycleId: string): Promise<{ approvedAt: Date | null; approvedBy: string | null }> {
  const [row] = await db
    .select({ approvedAt: contentCycles.approvedAt, approvedBy: contentCycles.approvedBy })
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);
  return { approvedAt: row?.approvedAt ?? null, approvedBy: row?.approvedBy ?? null };
}
