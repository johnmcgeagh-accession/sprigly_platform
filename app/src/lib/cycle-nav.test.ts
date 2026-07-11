/**
 * cycle-nav.test.ts — the month-label rule (nextMonth), the today-landing resolver
 * (resolveDayCycleId + fallbacks), and cross-month-move stability + reachability.
 */
import { describe, it, expect } from 'vitest';
import { nextMonth, resolveDayCycleId, postsOutsideMonth, type CycleMonthRef } from './cycle-nav';

describe('nextMonth — a cycle labels as the month it PLANS', () => {
  it('cycle_month → the following month', () => {
    expect(nextMonth('2026-06')).toBe('2026-07');
    expect(nextMonth('2026-07')).toBe('2026-08');
  });
  it('rolls over December → January of the next year', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
  it('accepts YYYY-MM-DD and ignores the day', () => {
    expect(nextMonth('2026-06-30')).toBe('2026-07');
  });
});

describe('resolveDayCycleId — DEFAULT LANDING = TODAY', () => {
  const cycles: CycleMonthRef[] = [
    { cycleId: 'jun', displayMonth: '2026-06' },
    { cycleId: 'jul', displayMonth: '2026-07' },
    { cycleId: 'aug', displayMonth: '2026-08' },
  ];

  it('lands on the cycle whose plan month contains today', () => {
    expect(resolveDayCycleId(cycles, '2026-07-12')).toBe('jul');
    expect(resolveDayCycleId(cycles, '2026-08-01')).toBe('aug');
  });
  it('no cycle for today → nearest FUTURE cycle', () => {
    // earl-of-east shape: cycles plan Aug + Sep; today is July → nearest future = Aug.
    const eoe: CycleMonthRef[] = [{ cycleId: 'aug', displayMonth: '2026-08' }, { cycleId: 'sep', displayMonth: '2026-09' }];
    expect(resolveDayCycleId(eoe, '2026-07-12')).toBe('aug');
  });
  it('no cycle for today and none ahead → most recent PAST cycle', () => {
    const past: CycleMonthRef[] = [{ cycleId: 'may', displayMonth: '2026-05' }, { cycleId: 'jun', displayMonth: '2026-06' }];
    expect(resolveDayCycleId(past, '2026-09-01')).toBe('jun');
  });
  it('empty list → null', () => {
    expect(resolveDayCycleId([], '2026-07-12')).toBeNull();
  });
});

describe('cross-month move: labels stay stable, moved post stays reachable', () => {
  // The Aug cycle plans August; one of its posts was date-moved from 2026-08-07 to
  // 2026-07-16. Labels are derived from cycle_month (nextMonth), NEVER post dates.
  const julCycleMonth = '2026-06';  // plans July
  const augCycleMonth = '2026-07';  // plans August

  it('the moved post does NOT relabel its cycle or collide with July', () => {
    // Label of each cycle is fixed by its cycle_month, regardless of the moved post's date.
    expect(nextMonth(julCycleMonth)).toBe('2026-07');
    expect(nextMonth(augCycleMonth)).toBe('2026-08');   // still August, not July
    // Distinct plan months → landing on today (July) still resolves to the July cycle,
    // never shadowed by the Aug cycle whose post now sits in July.
    const cycles: CycleMonthRef[] = [
      { cycleId: 'jul', displayMonth: nextMonth(julCycleMonth) },
      { cycleId: 'aug', displayMonth: nextMonth(augCycleMonth) },
    ];
    expect(resolveDayCycleId(cycles, '2026-07-12')).toBe('jul');
  });

  it('the moved post remains reachable in its cycle via the outside-this-month strip', () => {
    // The Aug cycle's loaded posts (by cycle, not by date) include the moved one.
    const augPosts = [
      { id: 'a1', date: '2026-08-03' },
      { id: 'a2', date: '2026-08-19' },
      { id: 'moved', date: '2026-07-16' },   // moved out of the plan month
    ];
    const outside = postsOutsideMonth(augPosts, '2026-08');
    expect(outside.map((p) => p.id)).toEqual(['moved']);   // surfaced, never dropped
  });
});
