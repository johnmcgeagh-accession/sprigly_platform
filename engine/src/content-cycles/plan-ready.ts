/**
 * plan-ready.ts — send the plan-ready email once a cycle's phase 2 has SETTLED.
 *
 * The gap this closes: the approval arc (client or auto) sent no plan-ready email at all.
 * The only send site is in the planning worker (planning.ts:1180), and the auto-approve
 * branch returns before ever enqueuing planning (scheduler.ts:283-293) — the two paths are
 * mutually exclusive by construction, so an approved cycle reached no send.
 *
 * ── Why "no posts generating" is NOT the predicate ───────────────────────────────────
 *
 * The fan-out enqueues a shape job AND a hook job per eligible post, in parallel
 * (draft-plan.ts:316-324, phase2.ts:84-97). Only shape writes status: shape.ts:160 moves
 * the post 'generating' → 'new'. hook.ts and script.ts write their own fields and NEVER
 * touch status. So the moment every shape job finishes, every post reads 'new' while the
 * hook jobs are still queued — a post-status-only predicate would fire the email while
 * half the reels still have no hook.
 *
 * The predicate is therefore both halves:
 *   1. no live post still in 'generating'  (the DB half)
 *   2. no pending shape/hook/script job keyed to this cycle  (the queue half)
 *
 * 'generation_failed' settles. It is terminal — nothing retries it, the post is
 * client-visible with its error, and a month with one broken caption is still a month the
 * client should be told about. Waiting for it would mean never sending.
 *
 * Jobs in 'failed' are likewise terminal (BullMQ only lands there once attempts are
 * exhausted); a job with retries left sits in 'delayed' or 'waiting', which DO block.
 *
 * ── Why it is gated on approval ──────────────────────────────────────────────────────
 *
 * Settlement runs after EVERY per-post generation job, including a one-off caption rewrite
 * a client asks for months later. Without a gate, such an edit on a cycle that never sent
 * would fire "your plan is ready" for a plan nobody approved. approved_at is stamped by the
 * approval core for BOTH client and auto approvals (draft-approval-core.ts:142), so gating
 * on it selects exactly the arc this fixes and excludes the baseline path, which keeps its
 * own send.
 */
import { and, eq, isNull, sql as dsql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { contentCycles, contentCyclePosts, clients, claimPlanReadySend } from '@sprigly/db';
import { ensureAppLink, monthLabelOf, nextMonth, sendAppReadyNotification, type PlanningDeps } from './planning.js';

export { claimPlanReadySend };

/** Job kinds whose ids embed a cycle id and whose completion can settle a cycle. */
export const GENERATION_JOB_KINDS = ['shape', 'hook', 'script'] as const;
export type GenerationJobKind = (typeof GENERATION_JOB_KINDS)[number];

/**
 * BullMQ states that mean "this job has not finished yet".
 *
 * 'completed' and 'failed' are excluded deliberately: both are terminal, and
 * GENERATION_JOB_OPTIONS keeps completed jobs around for an hour
 * (removeOnComplete.age 3600), so counting them would keep a cycle unsettled long after
 * its work was done.
 */
const PENDING_STATES = ['waiting', 'delayed', 'active', 'paused', 'prioritized'] as const;

/**
 * Does this job id belong to a generation job for this cycle?
 *
 * Pure, so the id contract is testable without Redis. Ids are `<kind>_<cycleId>_<postId>`
 * (queue.ts:28,128,185) — underscore-separated because BullMQ forbids colons in custom ids
 * (job-options.ts:20). The trailing separator matters: it stops `weekly_<cycleId>_...`
 * and `planning_<cycleId>` — neither a generation job — from matching.
 */
export function isGenerationJobForCycle(jobId: string | undefined, cycleId: string): boolean {
  if (!jobId) return false;
  return GENERATION_JOB_KINDS.some((kind) => jobId.startsWith(`${kind}_${cycleId}_`));
}

/** The queue half of the predicate. `excludeJobId` drops the job asking the question. */
export async function hasPendingGenerationJobs(
  queue: Queue, cycleId: string, excludeJobId?: string,
): Promise<boolean> {
  const jobs = await queue.getJobs([...PENDING_STATES]);
  return jobs.some((j) => j.id !== excludeJobId && isGenerationJobForCycle(j.id, cycleId));
}

/** The DB half. Soft-deleted posts are not work in flight. */
export async function hasGeneratingPosts(db: PlanningDeps['db'], cycleId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: dsql<number>`count(*)::int` })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.status, 'generating'),
      isNull(contentCyclePosts.deletedAt),
    ));
  return (row?.n ?? 0) > 0;
}

/** Both halves. A cycle is settled when nothing is generating and nothing is queued. */
export async function isCycleSettled(
  db: PlanningDeps['db'], queue: Queue, cycleId: string, excludeJobId?: string,
): Promise<boolean> {
  if (await hasGeneratingPosts(db, cycleId)) return false;
  return !(await hasPendingGenerationJobs(queue, cycleId, excludeJobId));
}

export type SettleOutcome =
  | 'sent'
  | 'not_settled'    // work still in flight
  | 'not_approved'   // baseline cycle, or an ad-hoc edit — not this path's to announce
  | 'already_sent'   // another worker claimed it, or the baseline already sent
  | 'no_link';       // no app link yet — do not claim, so a later job can try again

/**
 * Settle one cycle: check, claim, send. Safe to call after every generation job.
 *
 * Claim happens BEFORE the send, which trades "a lost email if the send throws" for
 * "never a double email". That trade is only sound because deliverTemplatedEmail is
 * best-effort and never throws (planning.ts:688-691) — a failure is logged, not raised.
 */
export async function settlePlanReady(
  deps: PlanningDeps, queue: Queue, cycleId: string, excludeJobId?: string,
): Promise<SettleOutcome> {
  const { db, logger } = deps;

  const [cycle] = await db
    .select({
      id: contentCycles.id, clientId: contentCycles.clientId, cycleMonth: contentCycles.cycleMonth,
      approvedAt: contentCycles.approvedAt, approvedBy: contentCycles.approvedBy,
      planReadySentAt: contentCycles.planReadySentAt,
    })
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);

  if (!cycle) return 'not_approved';
  if (cycle.approvedAt == null) return 'not_approved';
  if (cycle.planReadySentAt != null) return 'already_sent';
  if (!(await isCycleSettled(db, queue, cycleId, excludeJobId))) return 'not_settled';

  const appBaseUrl = deps.appBaseUrl ?? process.env['APP_BASE_URL'] ?? '';
  const appUrl = await ensureAppLink(db, cycle.clientId, cycleId, appBaseUrl, logger);
  if (!appUrl) {
    logger.warn({ cycleId }, 'plan-ready: settled but no app link — not claiming, will retry on the next job');
    return 'no_link';
  }

  if (!(await claimPlanReadySend(db, cycleId))) return 'already_sent';

  const [client] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(eq(clients.id, cycle.clientId))
    .limit(1);

  // The auto variant tells the client the month went ahead without them. Deriving it from
  // the stamp the approval core wrote is the only way it can be true.
  const autoApproved = cycle.approvedBy === 'auto';
  const monthLabel   = monthLabelOf(nextMonth(cycle.cycleMonth));

  await sendAppReadyNotification(deps, cycle.clientId, client?.name ?? '', monthLabel, appUrl, autoApproved);
  logger.info({ cycleId, autoApproved, monthLabel }, 'plan-ready: settled and sent');
  return 'sent';
}
