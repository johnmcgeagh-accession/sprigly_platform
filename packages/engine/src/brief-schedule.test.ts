/**
 * brief-schedule.test.ts — the extractor's dates, matched back to a segment's intent.
 *
 * The fixture is ivy-t's LIVE November brief, copied from content_cycles.structured_brief on
 * cycle 5ea00045 — including the shapes that make matching hard: five entries with no product
 * at all, two products whose arcs interleave, and vague timing that came back as ranges rather
 * than dates.
 */
import { describe, it, expect } from 'vitest';
import { briefArcDatesFor, arcRoleOf, productMatchesSubject, entryDate } from './brief-schedule.js';

/** ivy-t, November 2026, as stored. */
const LIVE = {
  schedule: [
    { date: '2026-11-05', type: 'restock-announcement', product: null, colourway: null, dateRange: null },
    { date: '2026-11-07', type: 'behind-the-scenes',    product: null, colourway: null, dateRange: null },
    { date: '2026-11-12', type: 'launch',    product: 'Hannah', colourway: 'green', dateRange: null },
    { date: '2026-11-12', type: 'move',      product: 'Maya',   colourway: null, dateRange: null },
    { date: '2026-11-14', type: 'customer-story', product: null, colourway: null, dateRange: null },
    { date: '2026-11-16', type: 'styling-tips',   product: null, colourway: null, dateRange: null },
    { date: '2026-11-17', type: 'giveaway',       product: null, colourway: null, dateRange: null },
    { date: '2026-11-21', type: 'feature', product: 'Connie', colourway: null, dateRange: null },
    { date: '2026-11-24', type: 'launch',  product: 'Connie', colourway: null, dateRange: null },
    { date: null, type: 'teaser',    product: 'Hannah', colourway: 'green', dateRange: { start: '2026-11-05', end: '2026-11-11' } },
    { date: null, type: 'follow-up', product: 'Hannah', colourway: 'green', dateRange: { start: '2026-11-13', end: '2026-11-19' } },
  ],
};

describe('the regression case, from live data', () => {
  /**
   * "On the 12th we're going to launch Hannah in green, can you write a teaser the week
   * before" placed the month on 1/5/8. The extractor had 12 November all along.
   */
  it('gives the Hannah arc the dates the client actually asked for', () => {
    expect(briefArcDatesFor(LIVE, 'Hannah in green')).toEqual({
      launch:   '2026-11-12',
      tease:    '2026-11-05',   // the far edge of 5–11: "the week before"
      followUp: '2026-11-19',   // the far edge of 13–19: "the week after"
    });
  });

  it('keeps the two products apart', () => {
    expect(briefArcDatesFor(LIVE, 'Big Connie relaunch')).toEqual({ launch: '2026-11-24' });
  });

  /** Five of the eleven entries carry no product. They are single dated posts whose segment
   *  states the date in words, so the classifier already places them — and there is no key
   *  here to match them on anyway. */
  it('has nothing to say about a product-less post, and says nothing', () => {
    expect(briefArcDatesFor(LIVE, 'giveaway post')).toEqual({});
    expect(briefArcDatesFor(LIVE, 'behind the scenes')).toEqual({});
  });

  it('ignores entry types that are not part of an arc', () => {
    // 'move' and 'feature' are dated entries with products, and neither is an arc part.
    expect(briefArcDatesFor(LIVE, 'the Maya post')).toEqual({});
  });
});

describe('matching', () => {
  it('matches a product name on word boundaries, not as a substring', () => {
    expect(productMatchesSubject('Ali', 'That launch is about Ali')).toBe(true);
    expect(productMatchesSubject('Ali', 'the Palia collection')).toBe(false);   // not inside a word
    expect(productMatchesSubject('Hannah', 'hannah in green')).toBe(true);      // case-insensitive
    expect(productMatchesSubject('', 'anything')).toBe(false);
  });

  it('does not throw on a product name containing regex metacharacters', () => {
    expect(() => productMatchesSubject('C++ (v2)', 'the C++ (v2) launch')).not.toThrow();
    expect(productMatchesSubject('C++ (v2)', 'the C++ (v2) launch')).toBe(true);
  });

  it('reads the arc role off the model’s free-form type label', () => {
    expect(arcRoleOf('launch')).toBe('launch');
    expect(arcRoleOf('relaunch-launch')).toBe('launch');
    expect(arcRoleOf('teaser')).toBe('tease');
    expect(arcRoleOf('build-up')).toBe('tease');
    expect(arcRoleOf('follow-up')).toBe('followUp');
    // Order matters: a tease of a relaunch is a tease.
    expect(arcRoleOf('relaunch-tease')).toBe('tease');
    expect(arcRoleOf('restock-announcement')).toBeNull();
    expect(arcRoleOf(null)).toBeNull();
  });
});

describe('a vague window resolves to the edge furthest from the launch', () => {
  it('takes the start for a tease and the end for a follow-up', () => {
    const tease = { dateRange: { start: '2026-11-05', end: '2026-11-11' } };
    const follow = { dateRange: { start: '2026-11-13', end: '2026-11-19' } };
    expect(entryDate(tease, 'tease', '2026-11-12')).toBe('2026-11-05');
    expect(entryDate(follow, 'followUp', '2026-11-12')).toBe('2026-11-19');
  });

  it('falls back sensibly with no launch to measure from', () => {
    expect(entryDate({ dateRange: { start: '2026-11-05', end: '2026-11-11' } }, 'tease', null)).toBe('2026-11-05');
    expect(entryDate({ dateRange: { start: '2026-11-13', end: '2026-11-19' } }, 'followUp', null)).toBe('2026-11-19');
  });

  it('prefers an exact date over a range when both somehow appear', () => {
    expect(entryDate({ date: '2026-11-12', dateRange: { start: '2026-11-01', end: '2026-11-30' } }, 'launch', null))
      .toBe('2026-11-12');
  });
});

/**
 * Every one of these is a real state the caller can hand over: the extraction runs inside a
 * 25s race and returns null on timeout, and the column is jsonb written by a model.
 */
describe('degrades rather than throws', () => {
  it.each([
    ['null',            null],
    ['undefined',       undefined],
    ['a string',        'not a brief'],
    ['no schedule',     { products: [] }],
    ['schedule not an array', { schedule: 'nope' }],
    ['null entries',    { schedule: [null, undefined, 42] }],
    ['entries missing every field', { schedule: [{}] }],
    ['a malformed date', { schedule: [{ type: 'launch', product: 'Hannah', date: 'the 12th' }] }],
  ])('%s → {}', (_label, brief) => {
    expect(briefArcDatesFor(brief, 'Hannah in green')).toEqual({});
  });

  it('an empty subject matches nothing', () => {
    expect(briefArcDatesFor(LIVE, '   ')).toEqual({});
  });

  it('a partial arc returns only what it has', () => {
    const onlyLaunch = { schedule: [{ date: '2026-11-12', type: 'launch', product: 'Hannah' }] };
    expect(briefArcDatesFor(onlyLaunch, 'Hannah in green')).toEqual({ launch: '2026-11-12' });

    const onlyTease = { schedule: [{ date: '2026-11-05', type: 'teaser', product: 'Hannah' }] };
    expect(briefArcDatesFor(onlyTease, 'Hannah in green')).toEqual({ tease: '2026-11-05' });
  });

  it('the first entry of each role wins, so a duplicated role cannot flip the answer', () => {
    const twoLaunches = { schedule: [
      { date: '2026-11-12', type: 'launch', product: 'Hannah' },
      { date: '2026-11-20', type: 'launch', product: 'Hannah' },
    ] };
    expect(briefArcDatesFor(twoLaunches, 'Hannah').launch).toBe('2026-11-12');
  });
});
