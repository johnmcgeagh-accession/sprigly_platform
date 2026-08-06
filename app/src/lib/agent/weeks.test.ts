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
import { mondayOf, weekWindows, weekLines, dayLabel, addDays, weeksInSpan } from './weeks';
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

  it('a week with no planned posts renders the sentence it always did, to the byte', () => {
    // The guard on the block below: the fix must not rewrite the line every committed client
    // already gets. Same posts, no beats, same string.
    const { summary } = bucketCycleState(POSTS as never, TODAY, null, []);
    expect(summary).toContain('NEXT WEEK holds: 1 post — 2026-08-05.');
    expect(summary).toContain('THIS WEEK holds: 1 post — 2026-07-29.');
    expect(summary).not.toContain('planned post');
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

/**
 * The week that crosses into a draft month.
 *
 * Measured through query-eval on 26 August 2026: Mon 31 Aug – Sun 6 Sep holds five posts — one
 * written in August, four planned in September — and the state said *"NEXT WEEK holds: 1 post"*.
 * The agent answered *"Next week holds 1 post… The rest of the week is empty"*, which is the
 * state quoted correctly. The bucketing was right again; the beats were simply never bucketed.
 */
describe('a week that crosses into a draft month counts the planned posts too', () => {
  const TODAY = new Date('2026-08-26T00:00:00');    // Wed 26 Aug → next week is 31 Aug – 6 Sep
  const beat = (id: string, date: string) => ({
    id, cycleId: 'cyc-sep', date, format: 'reel', pillar: 'P', title: 'T',
    position: 0, slotType: 'proven', evidence: { basis: 'template' }, assumptions: [],
  });
  const AUG = [post('p-aug', '2026-08-31')];
  const SEP = [beat('b1', '2026-09-01'), beat('b2', '2026-09-01'), beat('b3', '2026-09-02'), beat('b4', '2026-09-04')];

  const state = () => bucketCycleState(AUG as never, TODAY, ['2026-08', '2026-09'], SEP as never);

  it('states the total, and it is not the written count', () => {
    const { summary } = state();
    expect(summary).toContain('NEXT WEEK holds: 5 in total');
    expect(summary).not.toContain('NEXT WEEK holds: 1 post');
  });

  it('names every date in the window, on both sides of the boundary', () => {
    const line = state().summary.split('\n').find((l) => l.startsWith('NEXT WEEK holds'))!;
    for (const d of ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-04']) expect(line).toContain(d);
    // A doubled date is listed once per post — five dates for five posts, as the count says.
    expect(line.match(/2026-09-01/g)).toHaveLength(2);
  });

  it('marks the four that have no copy, so a flat five cannot be read as five written posts', () => {
    const line = state().summary.split('\n').find((l) => l.startsWith('NEXT WEEK holds'))!;
    expect(line).toContain('1 written post');
    expect(line).toContain('4 planned posts, not yet written');
    // Prompt vocabulary is what a model repeats back; spec §7 fences the internal word.
    expect(line).not.toMatch(/\bbeats?\b/i);
  });

  it('and the buckets carry them, so the sentence and the data cannot disagree', () => {
    const { nextWeek, nextWeekBeats, thisWeekBeats } = state();
    expect(nextWeek.map((p) => p.id)).toEqual(['p-aug']);
    expect(nextWeekBeats.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(thisWeekBeats).toEqual([]);
  });

  it('a window holding ONLY planned posts says so without claiming written ones', () => {
    // Today moved a week on: 7–13 Sep is inside the draft month on both ends.
    const { summary } = bucketCycleState([], new Date('2026-09-02T00:00:00'), ['2026-09'],
      [beat('b9', '2026-09-08')] as never);
    expect(summary).toContain('NEXT WEEK holds: 1 planned post, not one of them written yet — 2026-09-08.');
  });

  it('beats still do not reach the live-post total — that exclusion is deliberate', () => {
    // The counterpart to the fix: the week LINE counts them, the status tally does not, because
    // every beat carries the internal status `draft` and a beat is not the plan.
    expect(state().summary).toMatch(/COMBINED: 1 live posts/);
    expect(state().counts).toEqual({ planned: 1 });
  });
});

/**
 * EVERY week, not two — the same failure one week further out.
 *
 * Measured live on 5 August 2026: "what's happening in the last week of august" came back
 * *"The last week of August (Mon 26 August to Sun 1 September) holds 6 posts"*. 26 August 2026
 * is a WEDNESDAY and 1 September is a Tuesday; the week is Mon 24 to Sun 30 and it holds 7 —
 * the answer omitted the 24th and 25th and included the 31st. Wrong boundaries, wrong weekday
 * names, wrong count, stated fluently. THIS WEEK and NEXT WEEK were the only weeks the state
 * named, so every other week was arithmetic.
 */
describe('every week in the span is enumerated and counted', () => {
  const TODAY = new Date('2026-08-05T00:00:00');    // Wed 5 Aug → this week Mon 3 – Sun 9
  const AUG = [
    post('a24', '2026-08-24'), post('a25', '2026-08-25'), post('a26', '2026-08-26'),
    post('a27', '2026-08-27'), post('a28', '2026-08-28'), post('a29', '2026-08-29'),
    post('a04', '2026-08-04'),
  ];
  const line = (summary: string, from: string) =>
    summary.split('\n').find((l) => l.trim().startsWith(from))!;
  const state = () => bucketCycleState(AUG as never, TODAY, ['2026-08']).summary;

  it('weeksInSpan covers the month end to end, straddling both boundaries', () => {
    const w = weeksInSpan(['2026-08']);
    // The first week begins in July and the last ends in September: a week that crosses a
    // boundary is ONE week, not two halves.
    expect(w[0]).toEqual({ from: '2026-07-27', to: '2026-08-02' });
    expect(w[w.length - 1]).toEqual({ from: '2026-08-31', to: '2026-09-06' });
    expect(w.every((x, i) => i === 0 || x.from === addDays(w[i - 1]!.from, 7))).toBe(true);
  });

  it('states the last week of August correctly — the answer that was wrong live', () => {
    const l = line(state(), '2026-08-24');
    expect(l).toContain('2026-08-24 to 2026-08-30 (Mon 24 August to Sun 30 August)');
    expect(l).toContain('6 posts');            // the six in this fixture's 24–30 window
    // The boundaries the model invented must not be derivable from any line.
    expect(state()).not.toContain('2026-08-26 to 2026-09-01');
  });

  it('marks THIS WEEK and NEXT WEEK so the two blocks cannot disagree', () => {
    const s = state();
    expect(line(s, '2026-08-03')).toContain('[THIS WEEK]');
    expect(line(s, '2026-08-10')).toContain('[NEXT WEEK]');
    // Exactly one of each, and no other week wears a marker.
    expect(s.match(/\[THIS WEEK\]/g)).toHaveLength(1);
    expect(s.match(/\[NEXT WEEK\]/g)).toHaveLength(1);
    // And the marked line agrees with the counted line above it.
    expect(s).toContain('THIS WEEK holds: 1 post — 2026-08-04.');
    expect(line(s, '2026-08-03')).toContain('1 post');
  });

  it('splits written from planned per week, and says nothing about an empty one', () => {
    const beat = (id: string, date: string) => ({
      id, cycleId: 'c', date, format: 'reel', pillar: 'P', title: 'T',
      position: 0, slotType: 'proven', evidence: { basis: 'template' }, assumptions: [],
    });
    const s = bucketCycleState(
      [post('w1', '2026-09-07')] as never, new Date('2026-09-02T00:00:00'), ['2026-09'],
      [beat('b1', '2026-09-08'), beat('b2', '2026-09-09')] as never,
    ).summary;
    expect(line(s, '2026-09-07')).toContain('3 posts, 1 written + 2 planned (not yet written)');
    expect(line(s, '2026-09-14')).toContain('0 posts.');
  });

  it('tells the model to name its window when the phrase fits more than one line', () => {
    expect(state()).toContain('SAY WHICH DATES YOU USED');
    expect(QUERY_SYSTEM_PROMPT).toContain('NAME THE WINDOW YOU USED');
    expect(QUERY_SYSTEM_PROMPT).toMatch(/first week of September/);
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
