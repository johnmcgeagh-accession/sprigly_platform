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

// ── The arc's offsets, when the brief supplies them ─────────────────────────────────
import { applyLaunchArc } from './draft-transforms.js';
import type { MonthScopedIntent, TransformBeat } from './index.js';

/** Ten replaceable template beats — the pool the arc displaces into. */
const pool = (): TransformBeat[] => Array.from({ length: 10 }, (_, i) => ({
  id: `b${i}`, date: `2027-01-${String(i + 1).padStart(2, '0')}`, format: 'single',
  pillar: 'Home', title: `Filler ${i}`, position: i,
  beatMeta: { slotType: 'proven' as const, rationaleEvidence: { basis: 'template' as const } },
}));

const launchIntent = (start: string): MonthScopedIntent => ({
  kind: 'launch', subject: 'Hannah in green', sourceText: 'launch Hannah in green',
  dateRange: { start, end: start },
});

/** The arc's dates, in order, from a result's add ops. */
const placed = (r: { ops: Array<{ op: string; date?: string; title?: string }> }) =>
  r.ops.filter((o) => o.op === 'add').map((o) => `${o.date} ${String(o.title).split('— ')[1]}`);

describe('LAUNCH_ARC takes the brief’s offsets when it has them', () => {
  it('THE REGRESSION: "a teaser the week before" is finally a week before', () => {
    const r = applyLaunchArc(launchIntent('2027-01-12'), pool(), '2027-01', {
      launch: '2027-01-12', tease: '2027-01-05', followUp: '2027-01-19',
    });
    expect(placed(r)).toEqual([
      '2027-01-05 Tease',
      '2027-01-12 Launch',
      '2027-01-19 Follow-up',
    ]);
  });

  it('falls back to [-5, 0, +3] when the brief dates nothing', () => {
    const r = applyLaunchArc(launchIntent('2027-01-12'), pool(), '2027-01');
    expect(placed(r)).toEqual([
      '2027-01-07 Tease',
      '2027-01-12 Launch',
      '2027-01-15 Follow-up',
    ]);
  });

  /** Each part is independent — a brief that names one does not forfeit the other. */
  it('mixes: the brief’s tease, the constant’s follow-up', () => {
    const r = applyLaunchArc(launchIntent('2027-01-12'), pool(), '2027-01', { launch: '2027-01-12', tease: '2027-01-05' });
    expect(placed(r)).toEqual([
      '2027-01-05 Tease',
      '2027-01-12 Launch',
      '2027-01-15 Follow-up',   // +3, unchanged
    ]);
  });

  it('mixes the other way: the constant’s tease, the brief’s follow-up', () => {
    const r = applyLaunchArc(launchIntent('2027-01-12'), pool(), '2027-01', { launch: '2027-01-12', followUp: '2027-01-19' });
    expect(placed(r)).toEqual([
      '2027-01-07 Tease',       // -5, unchanged
      '2027-01-12 Launch',
      '2027-01-19 Follow-up',
    ]);
  });

  /** The clamping predates this and is untouched: a brief-supplied date off the edge of the
   *  month gets exactly what a computed offset off the edge gets. */
  it('clamps a brief date outside the plan month, like any other', () => {
    const r = applyLaunchArc(launchIntent('2027-01-12'), pool(), '2027-01', {
      launch: '2027-01-12', tease: '2026-12-20', followUp: '2027-02-14',
    });
    expect(placed(r)).toEqual([
      '2027-01-01 Tease',       // clamped to the month's first day
      '2027-01-12 Launch',
      '2027-01-31 Follow-up',   // clamped to its last
    ]);
  });

  it('still refuses to put a tease on or after its launch', () => {
    const r = applyLaunchArc(launchIntent('2027-01-12'), pool(), '2027-01', { launch: '2027-01-12', tease: '2027-01-12' });
    const dates = placed(r);
    expect(dates[0]).toBe('2027-01-11 Tease');   // slid to the day before, not left colliding
    expect(dates[1]).toBe('2027-01-12 Launch');
  });

  it('says so when a launch on the 1st leaves no room for the brief’s tease', () => {
    const r = applyLaunchArc(launchIntent('2027-01-01'), pool(), '2027-01', { launch: '2027-01-01', tease: '2026-12-25' });
    expect(placed(r).some((p) => p.includes('Tease'))).toBe(false);
    expect(r.note).toMatch(/no room for a tease/);
  });
});
