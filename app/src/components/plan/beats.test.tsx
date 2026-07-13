/**
 * beats test (Build 3, Part D; extended Build 6) — beatsInMonth filters a structured_brief's
 * schedule to the viewed month, handles single-day AND range beats (clipping ranges to the
 * month), and is null-safe; BeatMarker renders a marker DISTINCT from a post, and renders a
 * range beat as a spanning indicator (start-day label + suffix, continuation-day band).
 * Component render uses react-dom/server (app vitest env is node).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// plan.ts (and its @/lib/steps import) load the db client at module scope — mock it away so the
// pure beatsInMonth can be imported without DATABASE_URL.
vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {}, PRE_PLANNING_STATUSES: new Set<string>() }));
vi.mock('@/lib/steps', () => ({ listStepsForPosts: async () => new Map() }));

import { beatsInMonth } from '@/lib/plan';
import { BeatMarker, beatLabel, rangeSuffix, beatFlashText } from './BeatMarker';

describe('beatsInMonth', () => {
  const brief = {
    schedule: [
      { date: '2026-08-05', dateRange: null, type: 'launch', product: 'Wren vest', colourway: 'sage', note: 'Wren vest goes live' },
      { date: '2026-08-21', dateRange: null, type: 'weekend-style-guide', product: null, colourway: null, note: 'WSG' },
      { date: '2026-09-02', dateRange: null, type: 'launch', product: 'other', colourway: null, note: 'next month' },
    ],
  };

  it('returns [] for a null / malformed brief (pre-extraction is graceful)', () => {
    expect(beatsInMonth(null, '2026-08')).toEqual([]);
    expect(beatsInMonth({}, '2026-08')).toEqual([]);
    expect(beatsInMonth({ schedule: 'nope' }, '2026-08')).toEqual([]);
  });

  it('filters to the viewed month and maps single-day beats with endDate null', () => {
    const beats = beatsInMonth(brief, '2026-08');
    expect(beats).toHaveLength(2);
    expect(beats.map((b) => b.date)).toEqual(['2026-08-05', '2026-08-21']);
    expect(beats[0]).toEqual({ date: '2026-08-05', endDate: null, type: 'launch', product: 'Wren vest', colourway: 'sage', note: 'Wren vest goes live' });
    expect(Object.keys(beats[0]!)).not.toContain('format');
  });

  it('reads persisted pre-range beats (date only, no dateRange key) as single-day beats', () => {
    const legacy = { schedule: [{ date: '2026-08-10', type: 'feature', product: null, colourway: null, note: 'legacy' }] };
    expect(beatsInMonth(legacy, '2026-08')).toEqual([{ date: '2026-08-10', endDate: null, type: 'feature', product: null, colourway: null, note: 'legacy' }]);
  });

  it('keeps a range beat overlapping the month and CLIPS it to the month bounds', () => {
    const b = { schedule: [{ date: null, dateRange: { start: '2026-08-25', end: '2026-08-31' }, type: 'warehouse-sale', product: null, colourway: null, note: 'the last week of August' }] };
    const [beat] = beatsInMonth(b, '2026-08');
    expect(beat).toEqual({ date: '2026-08-25', endDate: '2026-08-31', type: 'warehouse-sale', product: null, colourway: null, note: 'the last week of August' });
  });

  it('clips a range that straddles the month boundary to the in-month portion', () => {
    const b = { schedule: [{ date: null, dateRange: { start: '2026-07-28', end: '2026-08-04' }, type: 'x', product: null, colourway: null, note: 'straddle' }] };
    expect(beatsInMonth(b, '2026-08')[0]).toMatchObject({ date: '2026-08-01', endDate: '2026-08-04' });
    expect(beatsInMonth(b, '2026-07')[0]).toMatchObject({ date: '2026-07-28', endDate: '2026-07-31' });
  });

  it('drops a range beat that does not overlap the viewed month', () => {
    const b = { schedule: [{ date: null, dateRange: { start: '2026-09-01', end: '2026-09-10' }, type: 'x', product: null, colourway: null, note: 'early Sep' }] };
    expect(beatsInMonth(b, '2026-08')).toEqual([]);
  });
});

describe('BeatMarker', () => {
  const beat = { date: '2026-08-21', endDate: null, type: 'weekend-style-guide', product: null, colourway: null, note: 'Style the new midi' };
  const range = { date: '2026-08-25', endDate: '2026-08-31', type: 'warehouse-sale', product: 'Sale', colourway: null, note: 'the last week of August' };

  it('beatLabel prefers the product, else the (de-kebabed) type', () => {
    expect(beatLabel({ ...beat, product: 'Wren vest' })).toBe('Wren vest');
    expect(beatLabel(beat)).toBe('weekend style guide');
  });

  it('rangeSuffix + beatFlashText surface the resolved span', () => {
    expect(rangeSuffix('2026-08-25', '2026-08-31')).toBe('25–31 Aug');
    expect(rangeSuffix('2026-08-30', '2026-09-02')).toBe('30 Aug–2 Sep');
    expect(beatFlashText(beat)).toBe('Style the new midi');
    expect(beatFlashText(range)).toBe('the last week of August (25–31 Aug)');
  });

  it('renders a distinct, tap-able, read-only single-day marker (note in the tooltip)', () => {
    const html = renderToStaticMarkup(<BeatMarker beat={beat} day="2026-08-21" onClick={() => {}} />);
    expect(html).toContain('data-testid="beat-marker"');
    expect(html).toContain('<button');                 // tap-able
    expect(html).toContain('weekend style guide');     // label
    expect(html).toContain('title="Style the new midi"'); // tap/hover surfaces the note
    expect(html).toContain('data-beat-segment="single"');
    // NOT a post: no format words, no post-chip testid.
    expect(html.toLowerCase()).not.toContain('reel');
    expect(html.toLowerCase()).not.toContain('carousel');
    expect(html).not.toContain('data-testid="post-chip"');
  });

  it('range beat: START day shows the label + span suffix (desktop)', () => {
    const html = renderToStaticMarkup(<BeatMarker beat={range} day="2026-08-25" onClick={() => {}} />);
    expect(html).toContain('data-beat-segment="start"');
    expect(html).toContain('data-beat-range="2026-08-25/2026-08-31"');
    expect(html).toContain('Sale');            // label
    expect(html).toContain('25–31 Aug');       // span suffix
  });

  it('range beat: CONTINUATION day renders a band with no VISIBLE label text (desktop)', () => {
    const html = renderToStaticMarkup(<BeatMarker beat={range} day="2026-08-28" onClick={() => {}} />);
    expect(html).toContain('data-beat-segment="continuation"');
    // Band-only: the visible label span (text-ellipsis) is absent; the beat still carries its
    // name/span in aria-label + title so a screen reader announces it on continuation days.
    expect(html).not.toContain('text-ellipsis');
    expect(html).toContain('aria-label="Beat: Sale (25–31 Aug) — the last week of August"');
  });

  it('range beat on mobile: EVERY day lists the label + span suffix', () => {
    const html = renderToStaticMarkup(<BeatMarker beat={range} day="2026-08-28" mobile onClick={() => {}} />);
    expect(html).toContain('Sale');
    expect(html).toContain('25–31 Aug');
    expect(html).toContain('data-beat-segment="start"');   // mobile never uses the continuation band
  });
});
