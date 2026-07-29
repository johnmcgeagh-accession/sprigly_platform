/**
 * approval-counts.ts — what approving this month actually starts, in numbers.
 *
 * ── Where the numbers come from, and why there is no endpoint ────────────────────────
 *
 * They are derived CLIENT-SIDE from the planned posts already in memory. `GET /api/plan/draft`
 * loaded them before the pill could be tapped, so the client is already holding every fact the
 * sheet states. A pre-approval summary endpoint would be a second source for a number they have,
 * and two sources for one number is how a screen ends up disagreeing with itself at the exact
 * moment money is spent.
 *
 * The arithmetic is the fan-out's own, and it is not a guess: `startPhase2` queues a caption for
 * every approved post, a hook for every reel and carousel, and a script for every reel. If that
 * ever changes, this file is what has to change with it — which is the point of it being a file.
 *
 * ZERO ROWS ARE OMITTED, never printed. "0 hooks" is padding on a screen whose job is to state a
 * consequence plainly, and a month of ten single posts genuinely has nothing to say about hooks.
 *
 * Pure. No React.
 */
import type { DraftBeatView } from '@/lib/types';
import { formatNeedsHook, formatNeedsScript } from './format-change';

export interface ApprovalCounts {
  captions: number;
  hooks: number;
  scripts: number;
}

export function approvalCounts(beats: readonly Pick<DraftBeatView, 'format'>[]): ApprovalCounts {
  return {
    captions: beats.length,
    hooks: beats.filter((b) => formatNeedsHook(b.format)).length,
    scripts: beats.filter((b) => formatNeedsScript(b.format)).length,
  };
}

export interface CountRow { count: number; label: string }

/**
 * The rows the sheet lists, in the order generation runs them and with the zeroes dropped.
 *
 * Each label says what the number is FOR rather than naming the field: a client knows what a
 * caption is for and does not necessarily know what a hook is, so the row explains itself once
 * rather than assuming our vocabulary.
 */
export function approvalRows(counts: ApprovalCounts): CountRow[] {
  const rows: CountRow[] = [
    { count: counts.captions, label: counts.captions === 1 ? 'caption — for the one post in the month' : 'captions — one for every post in the month' },
    { count: counts.hooks, label: counts.hooks === 1 ? 'opening hook — for the reel or carousel' : 'opening hooks — for the reels and carousels' },
    { count: counts.scripts, label: counts.scripts === 1 ? 'script — for the reel' : 'scripts — one for each reel' },
  ];
  return rows.filter((r) => r.count > 0);
}
