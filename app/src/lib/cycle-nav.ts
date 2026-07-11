/**
 * cycle-nav.ts — the ONE rule for "which cycle represents today", shared by the server
 * landing (page.tsx) and the client Today button (usePlanData), so they can never drift.
 *
 * Pure — no DB, client-safe. Operates on the already-labelled cycle list (displayMonth =
 * the month a cycle PLANS, 'YYYY-MM') and a server-computed today ('YYYY-MM-DD', London,
 * the same editScopeToday source as the edit gate). Month strings sort lexically.
 */
export interface CycleMonthRef { cycleId: string; displayMonth: string }

/**
 * A cycle's plan month = the month AFTER its cycle_month ('YYYY-MM'). This is a cycle's
 * ONLY month label — populated or empty, it is NEVER derived from post dates, so a
 * cross-month-moved post can't relabel a cycle or collide two cycles in month-space.
 * Accepts 'YYYY-MM' or 'YYYY-MM-DD'; returns 'YYYY-MM'.
 */
export function nextMonth(cycleMonth: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(cycleMonth);
  if (!m) return cycleMonth.slice(0, 7);
  let year  = Number(m[1]);
  let month = Number(m[2]) + 1;
  if (month > 12) { month = 1; year += 1; }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * TRUE-ORPHAN posts: those whose scheduled_date falls in a month that NO cycle plans, so
 * they appear in no month grid at all (a post dated in a planned month now shows in that
 * month's date-authoritative grid — see loadCrossMonthPosts). The viewed cycle surfaces
 * its orphans under an "outside this month" strip so they're never silently dropped.
 * `plannedMonths` = every cycle's displayMonth. Pure; sorts by date ascending.
 */
export function orphanPosts<T extends { date: string }>(posts: readonly T[], plannedMonths: readonly string[]): T[] {
  const planned = new Set(plannedMonths);
  return posts.filter((p) => !planned.has(p.date.slice(0, 7))).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Resolve the cycle to land on / jump to for `today`:
 *   1. the cycle whose plan month CONTAINS today (displayMonth === today's YYYY-MM);
 *   2. else the nearest FUTURE cycle (client sees what's coming);
 *   3. else the most recent PAST cycle (read-only).
 * Returns null only when there are no cycles at all.
 */
export function resolveDayCycleId(cycles: readonly CycleMonthRef[], today: string): string | null {
  if (cycles.length === 0) return null;
  const month = today.slice(0, 7);

  const exact = cycles.find((c) => c.displayMonth === month);
  if (exact) return exact.cycleId;

  const future = cycles
    .filter((c) => c.displayMonth > month)
    .sort((a, b) => a.displayMonth.localeCompare(b.displayMonth))[0];   // nearest ahead
  if (future) return future.cycleId;

  const past = cycles
    .filter((c) => c.displayMonth < month)
    .sort((a, b) => b.displayMonth.localeCompare(a.displayMonth))[0];   // most recent behind
  return past?.cycleId ?? null;
}
