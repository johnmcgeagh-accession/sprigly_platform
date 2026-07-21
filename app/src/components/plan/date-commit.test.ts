/**
 * date-commit.test.ts — one date change, one mutation.
 *
 * The draft view bound its move mutation to the date input's `onChange`, and a date input
 * emits a change per intermediate value the picker produces. ivy-t's rehearsal logged every
 * move twice, and one of them was a no-op:
 *
 *   16:36:47  beat_moved  Tease  2026-08-01 → 2026-08-14   (×2)
 *   16:33:13  beat_moved  Follow-up  2026-08-24 → 2026-08-24   ← from == to
 *
 * Two DB writes and two activity rows per date change, plus ledger entries that record
 * nothing happening (docs/reports/ivy-t-rehearsal-failures.md).
 */
import { describe, it, expect } from 'vitest';
import { isRealDateChange } from './DraftPlanView';

describe('isRealDateChange', () => {
  it('a real move commits', () => {
    expect(isRealDateChange('2026-08-01', '2026-08-14')).toBe(true);
  });

  it('THE NO-OP: same date in, same date out — no mutation', () => {
    expect(isRealDateChange('2026-08-24', '2026-08-24')).toBe(false);
  });

  it('a cleared picker is not a date', () => {
    expect(isRealDateChange('2026-08-01', '')).toBe(false);
  });

  it('a half-typed value is not a date — the picker emits these while the year is typed', () => {
    for (const partial of ['2', '20', '202', '2026', '2026-0', '2026-08', '2026-08-']) {
      expect(isRealDateChange('2026-08-01', partial), partial).toBe(false);
    }
  });

  it('moving backwards is still a move', () => {
    expect(isRealDateChange('2026-08-14', '2026-08-01')).toBe(true);
  });

  it('a cross-month move commits — the server owns that policy, not this gate', () => {
    expect(isRealDateChange('2026-08-31', '2026-09-01')).toBe(true);
  });

  it('the intermediate values of ONE real edit produce exactly ONE commit', () => {
    // What the picker emits while the client changes 1 Aug → 14 Aug. Under the old onChange
    // binding every one of these was a mutation.
    const emitted = ['', '2026-08-1', '2026-08-14'];
    const committed = emitted.filter((v) => isRealDateChange('2026-08-01', v));
    expect(committed).toEqual(['2026-08-14']);
  });

  it('and re-blurring after the commit sends nothing further', () => {
    expect(isRealDateChange('2026-08-14', '2026-08-14')).toBe(false);
  });
});
