/**
 * plan-ready-claim.ts — the at-most-once claim for a cycle's plan-ready email.
 *
 * Lives in @sprigly/db, alongside sync-status.ts, for two reasons. It is a pure DB
 * operation with no planning knowledge. And both callers need it — the settlement path
 * (engine/.../plan-ready.ts) and the baseline planning path (engine/.../planning.ts) —
 * where the settlement module already imports from planning.ts, so defining it in either
 * would close an import cycle.
 *
 * The claim is ONE statement on purpose. Two workers settling the same cycle at the same
 * instant is the ordinary case, not the rare one (worker concurrency is 2), and a
 * read-then-write would let both observe NULL and both send. Here they contend on a single
 * row: exactly one UPDATE matches `plan_ready_sent_at IS NULL`, so exactly one caller is
 * told to send.
 *
 * REQUIRES migration 0089.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db as _db, contentCycles } from './index.js';

type Db = typeof _db;

/**
 * Try to claim the plan-ready send for `cycleId`.
 *
 * @returns true if THIS caller won the claim and must send; false if it was already
 *          claimed (by a concurrent settlement, or by an earlier completed run).
 */
export async function claimPlanReadySend(db: Db, cycleId: string, now: Date = new Date()): Promise<boolean> {
  const claimed = await db
    .update(contentCycles)
    .set({ planReadySentAt: now, updatedAt: now })
    .where(and(eq(contentCycles.id, cycleId), isNull(contentCycles.planReadySentAt)))
    .returning({ id: contentCycles.id });
  return claimed.length > 0;
}

/**
 * Give the claim back when the send did not happen.
 *
 * The claim is taken BEFORE the send so two concurrent settlements cannot both email. That
 * ordering is right, but it means a stamp records an ATTEMPT, not a delivery — and because
 * the stamp is the at-most-once key, a failed send was never retried. earl-of-east's October
 * plan-ready email failed for want of Gmail tokens and the cycle was left stamped as sent
 * (docs/reports/round-two-email-and-surface.md §A5).
 *
 * Releasing restores "nobody has sent this" so the next settled pass — or the daily sweep —
 * can try again. Deliberately NOT conditioned on who claimed it: the only caller is the one
 * that just failed to send, and a conditional release would need an owner column to be
 * correct about a case that cannot arise.
 */
export async function releasePlanReadySend(db: Db, cycleId: string): Promise<void> {
  await db
    .update(contentCycles)
    .set({ planReadySentAt: null, updatedAt: new Date() })
    .where(eq(contentCycles.id, cycleId));
}
