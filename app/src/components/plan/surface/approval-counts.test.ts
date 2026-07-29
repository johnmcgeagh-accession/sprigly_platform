/**
 * approval-counts.test.ts — the numbers on the one screen that spends money.
 *
 * The fixture is Earl of East's October as the dogfood run approved it: 1 reel, 2 carousels,
 * 7 single posts → 10 captions, 3 hooks, 1 script (build-d-approval-phase2.md §1). That is also
 * the arithmetic mockup 09 states, so the mockup and the code are pinned to the same month.
 */
import { describe, it, expect } from 'vitest';
import { approvalCounts, approvalRows } from './approval-counts';

const beats = (spec: Record<string, number>) =>
  Object.entries(spec).flatMap(([format, n]) => Array.from({ length: n }, () => ({ format })));

describe('approvalCounts', () => {
  it('matches the fan-out: a caption per post, a hook per reel and carousel, a script per reel', () => {
    expect(approvalCounts(beats({ reel: 1, carousel: 2, single: 7 })))
      .toEqual({ captions: 10, hooks: 3, scripts: 1 });
  });

  it('a month of single posts has no hooks and no scripts', () => {
    expect(approvalCounts(beats({ single: 4 }))).toEqual({ captions: 4, hooks: 0, scripts: 0 });
  });

  it('counts nothing for an empty month', () => {
    expect(approvalCounts([])).toEqual({ captions: 0, hooks: 0, scripts: 0 });
  });
});

describe('approvalRows', () => {
  it('OMITS the zero rows rather than printing "0 hooks"', () => {
    const rows = approvalRows(approvalCounts(beats({ single: 4 })));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(4);
    expect(rows.map((r) => r.label).join(' ')).not.toMatch(/hook|script/);
  });

  it('lists them in the order generation runs them', () => {
    const rows = approvalRows(approvalCounts(beats({ reel: 1, carousel: 2, single: 7 })));
    expect(rows.map((r) => r.count)).toEqual([10, 3, 1]);
  });

  it('says what each number is FOR, because a client need not know what a hook is', () => {
    const rows = approvalRows(approvalCounts(beats({ reel: 1, carousel: 2, single: 7 })));
    expect(rows[1]!.label).toContain('for the reels and carousels');
    expect(rows[2]!.label).toContain('for the reel');
  });

  it('reads singular where the month is singular', () => {
    const rows = approvalRows(approvalCounts(beats({ reel: 1 })));
    expect(rows.map((r) => `${r.count} ${r.label}`)).toEqual([
      '1 caption — for the one post in the month',
      '1 opening hook — for the reel or carousel',
      '1 script — for the reel',
    ]);
  });

  it('has nothing to say about an empty month', () => {
    expect(approvalRows(approvalCounts([]))).toEqual([]);
  });
});
