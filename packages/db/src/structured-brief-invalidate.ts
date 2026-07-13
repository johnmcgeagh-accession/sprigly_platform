/**
 * structured-brief-invalidate.ts — turn the extract-once structured_brief from
 * presence-keyed into change-keyed.
 *
 * ensureStructuredBrief (worker planning.ts) returns the persisted structured_brief if
 * non-null and never re-extracts. So when a cycle's intake_json changes BEFORE planning,
 * the persisted brief is stale — clear it here so the next planning run re-extracts from
 * the new intake. At or after 'planning' the brief is frozen (the plan is being/has been
 * built) and must NOT be touched.
 *
 * Lives in @sprigly/db (like stampPostsSyncStatus) so admin (saveIntake now) and the app
 * (Build 3's intake route) call the SAME function; `db` is injected by the caller so this
 * module needs no client.js import (no DATABASE_URL to load — unit-testable).
 */
import { eq } from 'drizzle-orm';
// type-only: erased at runtime, so importing this module does NOT load client.js / env.
import type { db as _db } from './client.js';
import { contentCycles } from './schema.js';

type Db = typeof _db;

/**
 * Cycle statuses strictly BEFORE planning — the only window in which an intake change may
 * invalidate the persisted brief. Mirrors the machine's pre-planning states
 * (machine.ts ALLOWED, up to and including intake_confirmed). 'failed' is intentionally
 * absent: a failed cycle's prior_status may be post-planning, so we never clear it.
 */
export const PRE_PLANNING_STATUSES: ReadonlySet<string> = new Set([
  'scheduled', 'requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed',
]);

export type BriefInvalidationResult =
  | 'cleared'                     // brief existed + pre-planning → set to null
  | 'noop_no_brief'              // pre-planning but nothing persisted → nothing to do
  | 'skipped_planning_or_after'  // status at/after planning (or failed) → left frozen
  | 'not_found';                 // no such cycle

/**
 * Clear content_cycles.structured_brief IFF the cycle is pre-planning and has a brief.
 * Idempotent and safe: post-planning cycles are never touched. Call AFTER any write that
 * changes intake_json. `db` is the caller's @sprigly/db instance.
 */
export async function clearStructuredBriefIfPrePlanning(
  db:      Db,
  cycleId: string,
): Promise<BriefInvalidationResult> {
  const rows = await db
    .select({ status: contentCycles.status, structuredBrief: contentCycles.structuredBrief })
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);

  const row = rows[0];
  if (!row) return 'not_found';
  if (!PRE_PLANNING_STATUSES.has(row.status)) return 'skipped_planning_or_after';
  if (row.structuredBrief == null) return 'noop_no_brief';

  await db
    .update(contentCycles)
    .set({ structuredBrief: null, updatedAt: new Date() })
    .where(eq(contentCycles.id, cycleId));

  return 'cleared';
}
