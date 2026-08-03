/**
 * ringed-days.ts — the days an open interpretation turn names.
 *
 * ── The one new behaviour on the desktop surface, and it needs no API ────────────────
 *
 * While a turn is still awaiting consent, the days it would touch are ringed in the month grid.
 * The client reads the sentence and sees where it lands in the same glance — which is the thing
 * a phone structurally cannot do, because there the conversation covers the month.
 *
 * It is a DERIVATION, not a feature: the dates come off the very items the turn's own lines are
 * built from (`lineFor`), so nothing is fetched, nothing is written, and the ring cannot claim
 * a date the line does not also say out loud. If the two ever disagreed, the line would be the
 * defect — but they cannot, because there is one source.
 *
 * ── Why BOTH ends of a move ─────────────────────────────────────────────────────────
 *
 * A move names two days and the client needs both: the one losing a post and the one gaining it.
 * Ringing only the destination would answer "where does it go" while leaving "what leaves the
 * 22nd" to be worked out from the calendar — which is the arithmetic the ring exists to spare
 * them. `lineFor` already renders both for exactly this reason (F3a: omitting the source made
 * the one field a client most needs to check invisible).
 *
 * Pure. No React.
 */
import type { InterpretedItem } from '@/lib/agent/types';

/** 'YYYY-MM-DD'. Anything else — undefined, an empty string, a malformed value — is dropped
 *  rather than rendered: a ring on a cell that does not exist is worse than no ring. */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every in-month day an open turn touches, deduplicated and sorted.
 *
 * Sorted because the result is compared by value in a few places (and read by a human in a
 * failing test); the grid itself only ever asks `has()`.
 */
export function ringedDays(items: readonly InterpretedItem[]): string[] {
  const out = new Set<string>();
  for (const item of items) {
    if (item.kind !== 'change') continue;
    for (const d of [item.fromDate, item.toDate]) {
      if (typeof d === 'string' && ISO.test(d)) out.add(d);
    }
  }
  return [...out].sort();
}

/** The predicate the grid takes. Built once per set so the grid is not rebuilding a Set per cell. */
export function ringedPredicate(items: readonly InterpretedItem[]): (iso: string) => boolean {
  const days = new Set(ringedDays(items));
  return (iso: string) => days.has(iso);
}
