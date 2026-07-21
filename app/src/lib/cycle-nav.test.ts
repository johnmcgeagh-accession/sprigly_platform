/**
 * cycle-nav.test.ts — the month-label rule (nextMonth), the today-landing resolver
 * (resolveDayCycleId + fallbacks), and cross-month-move stability + reachability.
 */
import { describe, it, expect } from 'vitest';
import { nextMonth, resolveDayCycleId, resolveLandingCycleId, orphanPosts, type CycleMonthRef } from './cycle-nav';

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

// ── resolveLandingCycleId — an outstanding draft outranks the date rule ────────
// The bug this fixes: the surface kind is derived from the LANDED cycle, so landing by
// date alone put a client with an unapproved October draft into the committed shell for
// August, showing "0 posts" for a month they were never asked about.
// (docs/reports/draft-mode-not-rendering.md)

describe('resolveLandingCycleId', () => {
  // Mirrors the report's Q7 result for earl-of-east: home is the draft cycle (October),
  // and today (2026-07-21) matches no cycle's plan month.
  const CYCLES = [
    { cycleId: 'oct', displayMonth: '2026-10' },
    { cycleId: 'sep', displayMonth: '2026-09' },
    { cycleId: 'aug', displayMonth: '2026-08' },
  ];
  const TODAY = '2026-07-21';

  it('lands on the home cycle when it holds a reviewable draft', () => {
    expect(resolveLandingCycleId({
      cycles: CYCLES, today: TODAY, homeCycleId: 'oct', homeHasReviewableDraft: true,
    })).toBe('oct');
  });

  it('falls back to the date rule when the home cycle has no draft', () => {
    // Unchanged behaviour: nearest future plan month ahead of today → August.
    expect(resolveLandingCycleId({
      cycles: CYCLES, today: TODAY, homeCycleId: 'oct', homeHasReviewableDraft: false,
    })).toBe('aug');
  });

  it('the date rule wins again once the draft is approved (no longer reviewable)', () => {
    // Approval moves the rows off 'draft', so cycleHasReviewableDraft goes false and this
    // reverts to the ordinary landing WITHOUT anything else changing.
    expect(resolveLandingCycleId({
      cycles: CYCLES, today: TODAY, homeCycleId: 'oct', homeHasReviewableDraft: false,
    })).toBe('aug');
  });

  it('exact plan-month match still beats nearest-future when there is no draft', () => {
    expect(resolveLandingCycleId({
      cycles: CYCLES, today: '2026-09-04', homeCycleId: 'oct', homeHasReviewableDraft: false,
    })).toBe('sep');
  });

  it('falls back to the home cycle when the list is empty', () => {
    expect(resolveLandingCycleId({
      cycles: [], today: TODAY, homeCycleId: 'oct', homeHasReviewableDraft: false,
    })).toBe('oct');
  });
});

// ── ?cycle= — approval lands on the month it just approved ────────────────────
// A bare reload re-ran the landing rule, and approval is exactly when that rule stops
// working: it clears the drafts, so the draft-wins branch goes false and the date rule sends
// the client somewhere else entirely (docs/reports/round-two-email-and-surface.md §B3).

describe('resolveLandingCycleId — an explicit cycle outranks the heuristics', () => {
  const CYCLES = [
    { cycleId: 'oct', displayMonth: '2026-10' },
    { cycleId: 'sep', displayMonth: '2026-09' },
    { cycleId: 'aug', displayMonth: '2026-08' },
  ];
  const TODAY = '2026-07-21';

  it('POST-APPROVAL: lands on the approved cycle, not the date-derived one', () => {
    // The exact uat shape: October just approved (so no draft remains), today is July, and
    // the date rule would pick August.
    expect(resolveLandingCycleId({
      cycles: CYCLES, today: TODAY, homeCycleId: 'oct',
      homeHasReviewableDraft: false, requestedCycleId: 'oct',
    })).toBe('oct');
  });

  it('outranks the draft-wins branch too — explicit beats every heuristic', () => {
    expect(resolveLandingCycleId({
      cycles: CYCLES, today: TODAY, homeCycleId: 'oct',
      homeHasReviewableDraft: true, requestedCycleId: 'sep',
    })).toBe('sep');
  });

  it('a FOREIGN or stale cycle is ignored silently — falls through to the ordinary rule', () => {
    expect(resolveLandingCycleId({
      cycles: CYCLES, today: TODAY, homeCycleId: 'oct',
      homeHasReviewableDraft: false, requestedCycleId: 'someone-elses-cycle',
    })).toBe('aug');                       // the date rule, unchanged
  });

  it('an absent param leaves ordinary arrival byte-unchanged', () => {
    expect(resolveLandingCycleId({
      cycles: CYCLES, today: TODAY, homeCycleId: 'oct', homeHasReviewableDraft: false,
    })).toBe('aug');
    expect(resolveLandingCycleId({
      cycles: CYCLES, today: TODAY, homeCycleId: 'oct', homeHasReviewableDraft: true,
    })).toBe('oct');
  });

  it('an empty string is not a request', () => {
    expect(resolveLandingCycleId({
      cycles: CYCLES, today: TODAY, homeCycleId: 'oct',
      homeHasReviewableDraft: false, requestedCycleId: '',
    })).toBe('aug');
  });
});
