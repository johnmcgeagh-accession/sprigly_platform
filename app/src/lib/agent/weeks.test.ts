/**
 * weeks.test.ts — F1, the week the client means.
 *
 * Live, 31 July 2026 (a Friday): *"what's happening next week"* was answered about **7–13
 * August**. That is today + 7 through today + 13 — a rolling seven days starting a week from now.
 * The right answer is Mon 3 – Sun 9 August.
 *
 * The bucketing was never wrong. `bucketCycleState` has anchored on Monday since it was written;
 * what it did was compute the correct week and then throw it away, because `answerQuery` reads
 * only `cycleState.summary` and the summary never said where the week began. So these cover both
 * halves: the arithmetic, at every weekday anchor and across a month and a year boundary, and the
 * fact that the answer now REACHES the prompt.
 */
import { describe, it, expect, vi } from 'vitest';

// `cycle-state` and `query` reach the db client for their OTHER exports; every rule under test
// here is pure. This stands in for the module-scope DATABASE_URL parse.
vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));
vi.mock('@sprigly/knowledge', () => ({ retrieveChunks: async () => [] }));
import { mondayOf, weekWindows, weekLines, dayLabel, addDays } from './weeks';
import { bucketCycleState } from './cycle-state';
import { TASK_PARSER_SYSTEM_PROMPT, renderUserMessage } from './task-parser';
import { QUERY_SYSTEM_PROMPT } from './query';

const post = (id: string, date: string) =>
  ({ id, cycleId: 'c', clientId: 'c1', channel: 'instagram', date, format: 'single', pillar: 'P', caption: 'x', status: 'planned', reviewState: null });

describe('the operator’s day: Friday 31 July 2026', () => {
  const TODAY = '2026-07-31';

  it('NEXT WEEK is Mon 3 – Sun 9 August, not 7–13', () => {
    const { nextWeek } = weekWindows(TODAY);
    expect(nextWeek).toEqual({ from: '2026-08-03', to: '2026-08-09' });
    // The answer that was actually given, pinned as impossible.
    expect(nextWeek.from).not.toBe(addDays(TODAY, 7));
    expect(nextWeek.to).not.toBe(addDays(TODAY, 13));
  });

  it('THIS WEEK is Mon 27 July – Sun 2 August, so it straddles the month', () => {
    expect(weekWindows(TODAY).thisWeek).toEqual({ from: '2026-07-27', to: '2026-08-02' });
  });
});

describe('every weekday anchor lands on the same two weeks', () => {
  // Mon 27 Jul … Sun 2 Aug 2026. Whichever day of it you stand on, the answer is the same.
  const WEEK = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02'];

  it.each(WEEK)('from %s', (day) => {
    expect(weekWindows(day)).toEqual({
      thisWeek: { from: '2026-07-27', to: '2026-08-02' },
      nextWeek: { from: '2026-08-03', to: '2026-08-09' },
    });
  });

  /**
   * SUNDAY IS THE END OF ITS WEEK, NOT THE START OF THE NEXT ONE — the case a Sunday-anchored
   * implementation gets wrong and no other day exposes. On Sun 2 August, "next week" is the 3rd,
   * one day away; today + 7 would be the 9th, which is that week's LAST day, so the naive reading
   * names a range starting six days late.
   */
  it('Sunday: next week starts TOMORROW, and today + 7 would land at the wrong end of it', () => {
    const { thisWeek, nextWeek } = weekWindows('2026-08-02');
    expect(thisWeek.to).toBe('2026-08-02');
    expect(nextWeek.from).toBe('2026-08-03');
    expect(addDays('2026-08-02', 7)).toBe(nextWeek.to);   // 9 Aug — the end, offered as the start
  });

  it('Monday: this week starts today', () => {
    expect(weekWindows('2026-07-27').thisWeek.from).toBe('2026-07-27');
  });
});

describe('boundaries', () => {
  it('a month boundary inside the week is not a week boundary', () => {
    // Mon 31 Aug 2026 — the week runs into September.
    expect(weekWindows('2026-08-31')).toEqual({
      thisWeek: { from: '2026-08-31', to: '2026-09-06' },
      nextWeek: { from: '2026-09-07', to: '2026-09-13' },
    });
  });

  it('the last days of a month whose next week is wholly in the next one', () => {
    expect(weekWindows('2026-09-30').nextWeek).toEqual({ from: '2026-10-05', to: '2026-10-11' });
  });

  it('a year boundary', () => {
    expect(weekWindows('2026-12-31')).toEqual({
      thisWeek: { from: '2026-12-28', to: '2027-01-03' },
      nextWeek: { from: '2027-01-04', to: '2027-01-10' },
    });
  });

  it('a leap-February boundary', () => {
    expect(weekWindows('2028-02-28').thisWeek).toEqual({ from: '2028-02-28', to: '2028-03-05' });
    expect(mondayOf('2028-02-29')).toBe('2028-02-28');
  });

  it('mondayOf is idempotent and never moves a Monday', () => {
    for (const d of ['2026-07-27', '2026-08-03', '2027-01-04']) expect(mondayOf(d)).toBe(d);
    expect(mondayOf(mondayOf('2026-07-31'))).toBe(mondayOf('2026-07-31'));
  });
});

describe('the answer reaches the prompts', () => {
  const TODAY = new Date(2026, 6, 31);   // Fri 31 July 2026, local
  const POSTS = [
    post('p-this', '2026-07-29'),   // this week
    post('p-next', '2026-08-05'),   // next week
    post('p-late', '2026-08-12'),   // the week after — inside today+7…today+13, and NOT next week
  ];

  it('the plan state STATES both windows rather than leaving them to be derived', () => {
    const { summary } = bucketCycleState(POSTS as never, TODAY);
    expect(summary).toContain('THIS WEEK is 2026-07-27 to 2026-08-02');
    expect(summary).toContain('NEXT WEEK is 2026-08-03 to 2026-08-09');
    expect(summary).toMatch(/never "seven days from today"/);
  });

  it('and it carries the counts from the buckets — which used to be computed and discarded', () => {
    const { summary, thisWeek, nextWeek } = bucketCycleState(POSTS as never, TODAY);
    expect(thisWeek.map((p) => p.id)).toEqual(['p-this']);
    expect(nextWeek.map((p) => p.id)).toEqual(['p-next']);
    expect(summary).toContain('NEXT WEEK holds: 1 post — 2026-08-05');
    // The 12th is a week further out. It must not be counted as next week's.
    expect(summary).not.toContain('NEXT WEEK holds: 2 posts');
  });

  it('the query prompt forbids counting forward from today', () => {
    expect(QUERY_SYSTEM_PROMPT).toMatch(/Monday-to-Sunday/);
    expect(QUERY_SYSTEM_PROMPT).toMatch(/NEVER "seven days from today"/i);
  });

  it('the parser message carries the same two lines, above the day table', () => {
    const msg = renderUserMessage('what’s happening next week', {
      today: '2026-07-31', viewedMonth: 'October 2026', cycleMonths: '- x', planDigest: '(none)', productIndex: '(none)',
    });
    expect(msg).toContain('THIS WEEK is 2026-07-27 to 2026-08-02');
    expect(msg).toContain('NEXT WEEK is 2026-08-03 to 2026-08-09');
    expect(msg.indexOf('NEXT WEEK is')).toBeLessThan(msg.indexOf('THE NEXT 14 DAYS'));
  });

  it('and the parser prompt states the rule the phrase actually needs', () => {
    expect(TASK_PARSER_SYSTEM_PROMPT).toMatch(/WEEKS RUN MONDAY TO SUNDAY/);
    expect(TASK_PARSER_SYSTEM_PROMPT).toMatch(/"Next week" is NOT today \+ 7 days/);
  });
});

describe('the human labels the copy is written from', () => {
  it('names the weekday and the month', () => {
    expect(dayLabel('2026-08-03')).toBe('Mon 3 August');
    expect(dayLabel('2026-08-09')).toBe('Sun 9 August');
  });

  it('weekLines reads as one block with today in it', () => {
    const lines = weekLines('2026-07-31').split('\n');
    expect(lines[0]).toBe('WEEKS RUN MONDAY TO SUNDAY. Today is Fri 31 July.');
    expect(lines).toHaveLength(4);
  });
});
