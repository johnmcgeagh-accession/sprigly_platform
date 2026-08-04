/**
 * The month an idea names, read out of the client's own prose.
 *
 * The cases below are the real backlog rows this was written for — the 19 undated inputs that
 * each named a month in their content and stored it nowhere else.
 */
import { describe, it, expect, vi } from 'vitest';

// Both functions under test are pure; the module they live in reads cycles, so its db and plan
// imports are stubbed exactly as `cycle-scoping.test.ts` does.
vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {} }));
vi.mock('../plan', () => ({ loadPlanPosts: async () => [], loadDraftBeats: async () => [] }));

import { monthNamedIn, monthWindow } from './cycle-state';

const AUG = '2026-08';   // the month the client is standing in

describe('monthNamedIn', () => {
  it('reads the month out of the real backlog rows', () => {
    expect(monthNamedIn('October idea: TV Halloween theme, people-focused on Hannah.', AUG)).toBe('2026-10');
    expect(monthNamedIn('I have an idea for October — Halloween theme', AUG)).toBe('2026-10');
    expect(monthNamedIn('Meadow candle launch is the 10th not the 1st October', AUG)).toBe('2026-10');
    expect(monthNamedIn("One thing going on in September is the back to school element", AUG)).toBe('2026-09');
  });

  it('takes abbreviations, and is case-insensitive', () => {
    expect(monthNamedIn('something for Sept', AUG)).toBe('2026-09');
    expect(monthNamedIn('a post in dec', AUG)).toBe('2026-12');
    expect(monthNamedIn('OCTOBER: pumpkins', AUG)).toBe('2026-10');
  });

  it('resolves the year forward from the anchor month', () => {
    expect(monthNamedIn('an idea for August', AUG)).toBe('2026-08');   // the month we are in
    expect(monthNamedIn('an idea for January', AUG)).toBe('2027-01');  // rolls the year
    expect(monthNamedIn('an idea for July', AUG)).toBe('2027-07');     // never a past month
  });

  it('returns null when no month is named', () => {
    expect(monthNamedIn('we should do more behind the scenes', AUG)).toBeNull();
    expect(monthNamedIn('A hard-working wardrobe of organic cotton staples', AUG)).toBeNull();
  });

  it('returns null when two different months are named', () => {
    expect(monthNamedIn('move the October launch into November', AUG)).toBeNull();
  });

  it('is not fooled by words that merely start like a month', () => {
    expect(monthNamedIn('our marketing plan, separately decided', AUG)).toBeNull();
    expect(monthNamedIn('a January post about our marketing', AUG)).toBe('2027-01');
  });

  it('reads "may" as the modal verb unless it is capitalised or follows a preposition', () => {
    expect(monthNamedIn('we may want more behind the scenes', AUG)).toBeNull();
    expect(monthNamedIn('you may find this useful', AUG)).toBeNull();
    expect(monthNamedIn('an idea for May', AUG)).toBe('2027-05');
    expect(monthNamedIn('an idea for may', AUG)).toBe('2027-05');
    expect(monthNamedIn('a post in may about linen', AUG)).toBe('2027-05');
    // The modal is not a month reference, so it must not make the sentence read as two months.
    expect(monthNamedIn('we may want a post in October', AUG)).toBe('2026-10');
  });

  it('does not read a month that is describing the subject as a window', () => {
    // The real row this guard exists for — June is what the video shows, not when to post it.
    expect(monthNamedIn(
      'A throwback post using the video of Sally fitting the pre-production long sleeve Ivy tee during the June heatwave',
      '2026-07',
    )).toBeNull();
    expect(monthNamedIn('a post about the August drop', AUG)).toBeNull();
    // A stated year is a stated date, so it is read.
    expect(monthNamedIn('a post about the October 2026 launch', AUG)).toBe('2026-10');
  });

  it('returns null for a malformed anchor rather than guessing a year', () => {
    expect(monthNamedIn('an idea for October', 'not-a-month')).toBeNull();
  });
});

describe('monthWindow', () => {
  it('never produces the 31st of a 30-day month — Postgres rejects rather than clamps', () => {
    expect(monthWindow('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(monthWindow('2026-04')).toEqual({ from: '2026-04-01', to: '2026-04-30' });
    expect(monthWindow('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthWindow('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });   // leap
    expect(monthWindow('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('files an undated row rather than half a window', () => {
    expect(monthWindow(null)).toEqual({ from: null, to: null });
    expect(monthWindow('nonsense')).toEqual({ from: null, to: null });
  });
});
