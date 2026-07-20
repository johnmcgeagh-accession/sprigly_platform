/**
 * draft-approval.ts — the app's transport around the shared approval core.
 *
 * The RULES live in @sprigly/engine (draft-approval-core.ts) so the client-approved path
 * and the D3 cutoff auto-approval cannot drift apart. Build D shipped them twice because
 * the worker cannot import from app/; this file keeps only what is genuinely app-side.
 */
import { eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { approveDraftCore, POST_STATUS_GENERATING, type ApproveDraftParams, type ApprovalResult, type ApprovalError } from '@sprigly/engine';

export { POST_STATUS_GENERATING };
export type { ApprovalResult, ApprovalError };
export type ApproveParams = ApproveDraftParams;

/** Approve a cycle's draft. See approveDraftCore for the rules and why they live there. */
export async function approveDraft(params: ApproveParams): Promise<ApprovalResult> {
  return approveDraftCore(db, params);
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
