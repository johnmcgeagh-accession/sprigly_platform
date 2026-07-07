/**
 * checklist.ts — PURE checklist derivations, shared by both future plan layouts
 * (desktop + mobile). Everything here is computed, never stored (see migration 0066):
 *
 *   due_date = post.scheduled_date − lead_days
 *   at_risk  = !done && due_date < today
 *   ring     = { done, total } over a post's steps
 *   buckets  = overdue / next-7-days / later, stable-sorted by due_date
 *
 * All functions take `today` as an explicit 'YYYY-MM-DD' string so they are
 * deterministic and unit-testable. Resolving "today" from the tenant timezone is a
 * separate, impure concern (see resolveTodayIso in app/src/lib/steps.ts). Dates are
 * handled as 'YYYY-MM-DD' strings and compared lexicographically, which is correct
 * for ISO dates and avoids any local-timezone drift from Date parsing.
 */

export type TaskBucket = 'overdue' | 'next7' | 'later';

/** The minimum a step needs for every derivation below. */
export interface DerivableStep {
  done: boolean;
  leadDays: number;
}

const DAY_MS = 86_400_000;

/** Parse a 'YYYY-MM-DD' string to a UTC-midnight epoch (timezone-neutral). */
function isoToUtc(iso: string): number {
  const [y, m, d] = iso.split('-');
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

/** Format a UTC epoch back to 'YYYY-MM-DD'. */
function utcToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both 'YYYY-MM-DD'); negative if b precedes a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((isoToUtc(b) - isoToUtc(a)) / DAY_MS);
}

/** due_date = scheduled_date − lead_days, as 'YYYY-MM-DD'. */
export function dueDate(scheduledDate: string, leadDays: number): string {
  return utcToIso(isoToUtc(scheduledDate) - leadDays * DAY_MS);
}

/** A step is at risk when it isn't done and its due date is already in the past. */
export function isAtRisk(step: DerivableStep, scheduledDate: string, today: string): boolean {
  return !step.done && dueDate(scheduledDate, step.leadDays) < today;
}

/** The done/total ring for a post's steps. */
export function ringOf(steps: readonly DerivableStep[]): { done: number; total: number } {
  return { total: steps.length, done: steps.reduce((n, s) => n + (s.done ? 1 : 0), 0) };
}

/** A post is at risk when any of its steps is at risk. */
export function postAtRisk(steps: readonly DerivableStep[], scheduledDate: string, today: string): boolean {
  return steps.some((s) => isAtRisk(s, scheduledDate, today));
}

/** Which bucket an outstanding step's due date falls into, relative to today. */
export function bucketOf(due: string, today: string): TaskBucket {
  if (due < today) return 'overdue';
  return daysBetween(today, due) <= 7 ? 'next7' : 'later';
}

/** A not-yet-done step to schedule, carrying its computed due date. */
export interface OutstandingTask<T> {
  item: T;
  due: string;
  bucket: TaskBucket;
}

/**
 * Bucket and stable-sort outstanding (not-done) steps for the Tasks view. Each input
 * carries the step's own scheduled date + lead days. Output is grouped into
 * overdue / next7 / later, each sorted ascending by due date; ties preserve input
 * order (stable). Done steps are excluded — the Tasks board only shows work left.
 */
export function groupTasks<T extends DerivableStep>(
  tasks: ReadonlyArray<T & { scheduledDate: string }>,
  today: string,
): Record<TaskBucket, Array<OutstandingTask<T>>> {
  const out: Record<TaskBucket, Array<OutstandingTask<T>>> = { overdue: [], next7: [], later: [] };
  tasks
    .map((item, index) => ({ item, index, due: dueDate(item.scheduledDate, item.leadDays) }))
    .filter(({ item }) => !item.done)
    // Stable sort: due date asc, original index as the tiebreaker.
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.index - b.index))
    .forEach(({ item, due }) => {
      const bucket = bucketOf(due, today);
      out[bucket].push({ item, due, bucket });
    });
  return out;
}
