/** plan-move — the optimistic-reschedule guards (race safety without a DOM). */
import { describe, it, expect } from 'vitest';
import { planMoveGuard, shouldReconcile } from './plan-move';

const posts = [{ id: 'a', date: '2026-08-05' }, { id: 'b', date: '2026-08-10' }];

describe('planMoveGuard', () => {
  it('accepts a real move and captures the previous date (for snap-back)', () => {
    expect(planMoveGuard('a', '2026-08-22', posts, new Set(), false)).toEqual({ prevDate: '2026-08-05' });
  });
  it('BLOCKS a second move on a card already reconciling (no double-apply / lost move)', () => {
    expect(planMoveGuard('a', '2026-08-22', posts, new Set(['a']), false)).toBeNull();
  });
  it('lets a DIFFERENT card move while another is pending (independent)', () => {
    expect(planMoveGuard('b', '2026-08-22', posts, new Set(['a']), false)).toEqual({ prevDate: '2026-08-10' });
  });
  it('no-ops a drop onto the same day, an unknown card, or a read-only surface', () => {
    expect(planMoveGuard('a', '2026-08-05', posts, new Set(), false)).toBeNull();   // same day
    expect(planMoveGuard('zzz', '2026-08-22', posts, new Set(), false)).toBeNull(); // unknown
    expect(planMoveGuard('a', '2026-08-22', posts, new Set(), true)).toBeNull();    // read-only
  });
});

describe('shouldReconcile', () => {
  it('refetches only when the move succeeded AND nothing else is still pending', () => {
    expect(shouldReconcile(true, new Set())).toBe(true);
    expect(shouldReconcile(true, new Set(['b']))).toBe(false);   // another move mid-flight — don't clobber
    expect(shouldReconcile(false, new Set())).toBe(false);       // failed → no refetch (snap-back already ran)
  });
});
