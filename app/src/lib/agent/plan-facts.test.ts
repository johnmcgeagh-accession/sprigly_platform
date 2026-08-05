/**
 * plan-facts.test.ts — the model is given the numbers, and stops counting.
 *
 * ── What is being guarded ────────────────────────────────────────────────────────────
 *
 * A settled 30-post September, asked about four times, answered 27, 15, 26, 30 and then 28.
 * Pillars came back as seven lines summing to 29 against a month holding 30, three of them
 * wrong and offsetting. Empty dates came back as 2 against 4, by subtracting posts from days —
 * valid only if no date holds more than one, and four September dates hold two.
 *
 * Every one of those is the same defect: a fact the plan state did not carry, so the model
 * derived it, and a derived number reads exactly like a read one. The fixture below is Ivy T's
 * real September shape — 30 posts on 26 dates, doubled on the 1st, 13th, 18th and 23rd, empty
 * on the 3rd, 5th, 6th and 7th, and the pillar and format spreads confirmed against SQL — so
 * these assertions fail if the arithmetic ever drifts from the month it was written for.
 *
 * The row-listing tests matter as much as the arithmetic. The state used to hand the answerer
 * 78 undifferentiated rows across three months under a window line naming two, with September's
 * own figure appearing nowhere; a correct count printed above a list that still invites counting
 * is half a fix.
 */
import { describe, it, expect, vi } from 'vitest';

// `cycle-state` imports the plan readers, which open a database connection at import time.
// The units under test are pure. Same mock as every other agent fixture here.
vi.mock('@/lib/plan', () => ({ loadPlanPosts: async () => [], loadDraftBeats: async () => [] }));
vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {} }));

import { daysInMonth, factLines, monthFacts, PLAN_FACTS_HEADING } from './plan-facts';
import { bucketCycleState } from './cycle-state';
import type { DraftBeatView, PlanPost } from '../types';

let seq = 0;
const post = (date: string, over: Partial<PlanPost> = {}): PlanPost => ({
  id: `p${++seq}`, cycleId: 'cyc-sep', clientId: 'cl',
  channel: 'instagram', date, format: 'reel', pillar: 'Simplify Your Morning', caption: 'words',
  status: 'new', reviewState: null, steps: [], hook: null, script: null, scriptLengthSeconds: null,
  overlay: null, pendingInstruction: null, generationError: null, banked: false, postingTime: null,
  title: null, rationale: null, ...over,
});

const beat = (date: string, title: string): DraftBeatView => ({
  id: `b-${date}`, cycleId: 'cyc-sep', date, format: 'carousel', pillar: 'Stable Foundations',
  title, position: 0, slotType: 'proven', evidence: { basis: 'template' } as DraftBeatView['evidence'],
  assumptions: [],
});

/**
 * IVY T'S SEPTEMBER, as it actually is in UAT (cycle 0b9677e5).
 *
 *   30 posts · 26 occupied dates · doubled on 01, 13, 18, 23 · empty on 03, 05, 06, 07
 *   pillars 9 / 4 / 4 / 4 / 3 / 3 / 3      formats reel 21, carousel 8, single 1
 *
 * Built from the shape rather than from thirty literals so the invariants stay readable, but the
 * numbers are the month's own and are asserted below against the figures the SQL returned.
 */
const SEPT = (() => {
  const occupied = [1, 2, 4, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
  const doubled = [1, 13, 18, 23];
  const dates = [...occupied, ...doubled].sort((a, b) => a - b)
    .map((d) => `2026-09-${String(d).padStart(2, '0')}`);

  const pillars = [
    ...Array<string>(9).fill('Simplify Your Morning'),
    ...Array<string>(4).fill('Ethical Without Compromise'),
    ...Array<string>(4).fill('Understands Real Women'),
    ...Array<string>(4).fill('Born From Real Need'),
    ...Array<string>(3).fill('Stable Foundations'),
    ...Array<string>(3).fill('A Supportive Friend, Always By Your Side'),
    ...Array<string>(3).fill('Personal Relationships'),
  ];
  const formats: Array<PlanPost['format']> = [
    ...Array<PlanPost['format']>(21).fill('reel'),
    ...Array<PlanPost['format']>(8).fill('carousel'),
    ...Array<PlanPost['format']>(1).fill('single'),
  ];
  return dates.map((date, i) => post(date, { pillar: pillars[i]!, format: formats[i]! }));
})();

const AUG = [
  post('2026-08-10', { cycleId: 'cyc-aug', pillar: 'Born From Real Need', format: 'carousel' }),
  post('2026-08-11', { cycleId: 'cyc-aug', pillar: 'Born From Real Need', format: 'reel' }),
];

describe('monthFacts — the four quantities nobody could read', () => {
  const f = monthFacts('2026-09', SEPT);

  it('counts the month, and the fixture is the month it was written for', () => {
    expect(SEPT).toHaveLength(30);
    expect(f.total).toBe(30);
    expect(f.days).toBe(30);
  });

  it('OCCUPIED dates are not the post count — 30 posts sit on 26 dates', () => {
    expect(f.occupied).toHaveLength(26);
    expect(f.total).not.toBe(f.occupied.length);
  });

  it('EMPTY dates are the four the client actually has free, not days minus posts', () => {
    expect(f.empty).toEqual(['2026-09-03', '2026-09-05', '2026-09-06', '2026-09-07']);
    // The wrong answer, pinned so the difference is visible: 30 − 30 = 0, and the model's
    // 30 − 28 = 2. Neither is 4, and neither can be reached from a post count alone.
    expect(f.empty.length).not.toBe(f.days - f.total);
  });

  it('names the dates holding more than one — the premise the model invents without them', () => {
    expect(f.doubled).toEqual([
      { date: '2026-09-01', n: 2 }, { date: '2026-09-13', n: 2 },
      { date: '2026-09-18', n: 2 }, { date: '2026-09-23', n: 2 },
    ]);
  });

  it('occupied ∪ empty is the whole calendar month, always', () => {
    expect(f.occupied.length + f.empty.length).toBe(f.days);
    expect(f.occupied.some((d) => f.empty.includes(d))).toBe(false);
  });

  it('pillars tally to the month, commonest first — the seven lines that summed to 29', () => {
    expect(f.byPillar).toEqual([
      { key: 'Simplify Your Morning', n: 9 },
      { key: 'Born From Real Need', n: 4 },
      { key: 'Ethical Without Compromise', n: 4 },
      { key: 'Understands Real Women', n: 4 },
      { key: 'A Supportive Friend, Always By Your Side', n: 3 },
      { key: 'Personal Relationships', n: 3 },
      { key: 'Stable Foundations', n: 3 },
    ]);
    expect(f.byPillar.reduce((s, t) => s + t.n, 0)).toBe(30);
  });

  it('formats and statuses tally to the same total', () => {
    expect(f.byFormat).toEqual([{ key: 'reel', n: 21 }, { key: 'carousel', n: 8 }, { key: 'single', n: 1 }]);
    expect(f.byStatus).toEqual([{ key: 'new', n: 30 }]);
    expect(f.byFormat.reduce((s, t) => s + t.n, 0)).toBe(30);
  });

  it('ties break alphabetically, so the same rows always render the same string', () => {
    const a = monthFacts('2026-09', SEPT).byPillar.map((t) => t.key);
    const b = monthFacts('2026-09', [...SEPT].reverse()).byPillar.map((t) => t.key);
    expect(a).toEqual(b);
  });

  it('counts BY DATE, never by owning cycle — the rule the calendar grid uses', () => {
    // An August-owned post moved onto 3 September fills that date for September's answer.
    const moved = post('2026-09-03', { cycleId: 'cyc-aug' });
    const g = monthFacts('2026-09', [...SEPT, moved]);
    expect(g.total).toBe(31);
    expect(g.empty).toEqual(['2026-09-05', '2026-09-06', '2026-09-07']);
  });

  it('ignores rows dated in other months entirely', () => {
    expect(monthFacts('2026-09', [...SEPT, ...AUG]).total).toBe(30);
    expect(monthFacts('2026-08', [...SEPT, ...AUG]).total).toBe(2);
  });

  it('a month with nothing in it is every date empty, from its own calendar', () => {
    expect(monthFacts('2026-09', []).empty).toHaveLength(30);
    expect(monthFacts('2026-02', []).empty).toHaveLength(28);
    expect(monthFacts('2028-02', []).empty).toHaveLength(29);
  });

  it('daysInMonth is the calendar’s, including a leap February', () => {
    expect(daysInMonth('2026-09')).toBe(30);
    expect(daysInMonth('2026-08')).toBe(31);
    expect(daysInMonth('2027-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
  });
});

describe('factLines — the numbers as the model reads them', () => {
  const lines = factLines('September 2026', monthFacts('2026-09', SEPT)).join('\n');

  it('states the count and the occupied-date count as different numbers', () => {
    expect(lines).toContain('September 2026 (2026-09): 30 posts, on 26 of the month’s 30 dates.');
  });

  it('LISTS the empty dates rather than counting them', () => {
    expect(lines).toContain('EMPTY DATES (4): 2026-09-03, 2026-09-05, 2026-09-06, 2026-09-07.');
  });

  it('forbids the subtraction that produced 2, at the point it would be made', () => {
    expect(lines).toContain('2026-09-01 (2 posts)');
    expect(lines).toMatch(/NEVER subtract posts from days to find empty dates/);
  });

  it('carries pillars and formats as stated counts', () => {
    expect(lines).toContain('PILLARS: 9 Simplify Your Morning, 4 Born From Real Need');
    expect(lines).toContain('FORMATS: 21 reel, 8 carousel, 1 single.');
  });

  it('a full month says so instead of printing an empty list', () => {
    const full = factLines('September 2026', monthFacts('2026-09', [
      ...Array.from({ length: 30 }, (_, i) => post(`2026-09-${String(i + 1).padStart(2, '0')}`)),
    ])).join('\n');
    expect(full).toContain('EMPTY DATES: none');
    expect(full).toContain('DATES HOLDING MORE THAN ONE POST: none');
  });

  it('an empty month is one line, not thirty ISO dates', () => {
    const none = factLines('September 2026', monthFacts('2026-09', []));
    expect(none).toHaveLength(1);
    expect(none[0]).toContain('0 posts. Every one of the month’s 30 dates is EMPTY.');
  });
});

describe('the plan state — September’s own number appears in it', () => {
  const TODAY = new Date(2026, 7, 5);                      // Wed 5 Aug 2026, Ivy T's day
  const state = bucketCycleState([...AUG, ...SEPT], TODAY, ['2026-08', '2026-09']);

  it('states 30 for September without the model having to find it', () => {
    expect(state.summary).toContain('September 2026 (2026-09): 30 posts, on 26 of the month’s 30 dates.');
  });

  it('and 2 for August, on its own line — never one month’s figure for another', () => {
    expect(state.summary).toContain('August 2026 (2026-08): 2 posts, on 2 of the month’s 31 dates.');
  });

  it('opens the block by forbidding the count outright', () => {
    expect(state.summary).toContain(PLAN_FACTS_HEADING);
    expect(state.summary).toMatch(/Do NOT count the rows underneath/);
  });

  it('the combined total says what it is the total OF', () => {
    expect(state.summary).toContain('ACROSS ALL 2 MONTHS IN VIEW, COMBINED: 32 live posts');
    expect(state.summary).toMatch(/It is NOT any single month's count/);
    // The sentence that was quoted back as one month's figure is gone when several are in view.
    expect(state.summary).not.toContain('Plan has 32 live posts');
  });

  it('a single month keeps the plain sentence — nothing to disambiguate', () => {
    const one = bucketCycleState(SEPT, TODAY, '2026-09');
    expect(one.summary).toContain('Plan has 30 live posts (30 new).');
    expect(one.summary).not.toContain('ACROSS ALL');
  });

  it('blocks the rows by month, each block stating its own size', () => {
    expect(state.summary).toContain('August 2026 (2026-08) — 2 written posts:');
    expect(state.summary).toContain('September 2026 (2026-09) — 30 written posts:');
  });

  it('every row still carries its ISO date and its side of today', () => {
    const rows = state.summary.split('\n').filter((l) => l.trim().startsWith('- 2026-'));
    expect(rows).toHaveLength(32);
    expect(rows.filter((l) => l.includes('2026-09-')).length).toBe(30);
  });

  it('a month in scope with no rows says so rather than being omitted', () => {
    const s = bucketCycleState(SEPT, TODAY, ['2026-08', '2026-09']);
    expect(s.summary).toContain('August 2026 (2026-08): 0 posts. Every one of the month’s 31 dates is EMPTY.');
    expect(s.summary).toContain('(no written posts on any date in this month)');
  });

  it('a post dated outside every month in scope is listed, never silently dropped', () => {
    const stray = post('2026-11-04', { cycleId: 'cyc-nov' });
    const s = bucketCycleState([...SEPT, stray], TODAY, ['2026-09']);
    expect(s.summary).toContain('Posts dated OUTSIDE the months above');
    expect(s.summary).toContain('2026-11-04');
  });

  it('naming no months at all falls back to the months the rows fall in', () => {
    const s = bucketCycleState([...AUG, ...SEPT], TODAY);
    expect(s.summary).toContain('September 2026 (2026-09): 30 posts');
    expect(s.summary).toContain('August 2026 (2026-08): 2 posts');
  });
});

describe('a DRAFT month is counted as what it holds, not reported as empty (F4)', () => {
  const BEATS = [beat('2026-09-01', 'Show me my ideas'), beat('2026-09-02', 'Why never to wear polyester')];
  const state = bucketCycleState([], new Date(2026, 7, 4), ['2026-09'], BEATS);

  it('never says every date is empty over a month holding planned posts', () => {
    expect(state.summary).not.toContain('Every one of the month’s 30 dates is EMPTY');
    expect(state.summary).toContain('It is NOT empty.');
  });

  it('counts the planned posts under their own heading', () => {
    expect(state.summary).toContain('September 2026 — PLANNED POSTS, not one of them written (2026-09): 2 posts');
    expect(state.summary).toContain('EMPTY DATES (28)');
  });

  it('and still says, as it always did, that none of them is written', () => {
    expect(state.summary).toMatch(/NO POST IN SEPTEMBER 2026 HAS BEEN WRITTEN/);
    expect(state.summary).toContain('Plan has 0 live posts');
  });

  it('a month holding both written and planned posts counts them separately', () => {
    const s = bucketCycleState([post('2026-09-10')], new Date(2026, 7, 4), ['2026-09'], BEATS);
    expect(s.summary).toContain('September 2026 — WRITTEN POSTS (2026-09): 1 post');
    expect(s.summary).toContain('September 2026 — PLANNED POSTS, not one of them written (2026-09): 2 posts');
  });
});
