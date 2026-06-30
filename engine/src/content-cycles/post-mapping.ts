/**
 * post-mapping.ts — shared mapping from a plan's per-post representation to a
 * `content_cycle_posts` row. Used by the planning dual-write (PlanPostRow → row)
 * and the one-off backfill CLI (CSV columns → row); both need the same format and
 * date normalisation, so it lives here once.
 */

export type PostFormat = 'reel' | 'carousel' | 'single' | 'email';

/** Normalise a plan's free-text format ("Reel" / "Carousel" / "Static" /
 *  "Single image", possibly combined) to the app's format enum. Anything that
 *  isn't a reel/carousel/email is a single image (covers "Static"). */
export function mapFormat(raw: string | undefined | null): PostFormat {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('reel'))     return 'reel';
  if (s.includes('carousel')) return 'carousel';
  if (s.includes('email'))    return 'email';
  return 'single';
}

/** A day-bearing date label ("14 Sep", "Sep 14", "14") + the plan month
 *  (YYYY-MM) → an ISO date 'YYYY-MM-DD'. The planner guarantees every date falls
 *  in the plan month, so we take the day number and pin it to targetMonth.
 *  Returns null when no day can be read (caller skips the row). */
export function isoDateInMonth(dateLabel: string | undefined | null, targetMonth: string): string | null {
  const m = (dateLabel ?? '').match(/\b(\d{1,2})\b/);
  if (!m) return null;
  const day = Math.min(31, Math.max(1, parseInt(m[1]!, 10)));
  return `${targetMonth}-${String(day).padStart(2, '0')}`;
}
