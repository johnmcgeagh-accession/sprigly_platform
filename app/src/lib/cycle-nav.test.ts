/**
 * cycle-nav.test.ts — the month-label rule (nextMonth), the today-landing resolver
 * (resolveDayCycleId + fallbacks), and cross-month-move stability + reachability.
 */
import { describe, it, expect } from 'vitest';
import { nextMonth, resolveDayCycleId, orphanPosts, type CycleMonthRef } from './cycle-nav';

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

  it('a post moved to a PLANNED month is NOT an orphan (it shows in that month’s grid)', () => {
    // Aug cycle posts; the moved one is dated in July, which the July cycle plans.
    const augPosts = [
      { id: 'a1', date: '2026-08-03' },
      { id: 'moved', date: '2026-07-16' },   // July IS planned → shown in July's grid
    ];
    const planned = ['2026-07', '2026-08'];
    expect(orphanPosts(augPosts, planned)).toEqual([]);   // strip empty for the common case
  });

  it('a post moved to a month NO cycle plans IS an orphan → surfaced in the strip', () => {
    const augPosts = [
      { id: 'a1', date: '2026-08-03' },
      { id: 'orphan', date: '2026-12-25' },  // no cycle plans December → shows in no grid
    ];
    const planned = ['2026-07', '2026-08'];
    expect(orphanPosts(augPosts, planned).map((p) => p.id)).toEqual(['orphan']);
  });
});

describe('date bucketing across cycles (calendar grid = posts ∪ crossMonthPosts by date)', () => {
  // The grid renders calendarPosts (viewed cycle ∪ cross-cycle-in-month) filtered by date.
  const viewedJulPosts = [
    { id: 'v-jul', cycleId: 'jul', date: '2026-07-10' },
    { id: 'v-aug', cycleId: 'jul', date: '2026-08-05' },   // a July-cycle post moved to August
  ];
  const crossInJul = [
    { id: 'c-jul', cycleId: 'aug', date: '2026-07-20' },   // an August-cycle post moved to July
  ];
  const calendarPosts = [...viewedJulPosts, ...crossInJul];
  const inMonth = (m: string) => calendarPosts.filter((p) => p.date.startsWith(m)).map((p) => p.id).sort();

  it('the July grid shows every July-dated post regardless of owning cycle', () => {
    expect(inMonth('2026-07')).toEqual(['c-jul', 'v-jul']);   // cross-cycle post included
  });
  it('a viewed-cycle post moved to August is NOT in the July grid (leaves on its date)', () => {
    expect(inMonth('2026-07')).not.toContain('v-aug');
    expect(inMonth('2026-08')).toContain('v-aug');
  });
  it('no post renders in more than one month view (exactly one date → one month)', () => {
    const months = ['2026-07', '2026-08'];
    const placements = calendarPosts.flatMap((p) => months.filter((m) => p.date.startsWith(m)).map(() => p.id));
    expect(new Set(placements).size).toBe(placements.length);
    expect(placements.length).toBe(calendarPosts.length);    // each placed exactly once
  });
});
