/**
 * beats test (Build 3, Part D) — beatsInMonth filters a structured_brief's schedule to the
 * viewed month and is null-safe; BeatMarker renders a marker DISTINCT from a post (no format
 * tag, tap-able, read-only). Component render uses react-dom/server (app vitest env is node).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// plan.ts (and its @/lib/steps import) load the db client at module scope — mock it away so the
// pure beatsInMonth can be imported without DATABASE_URL.
vi.mock('@sprigly/db', () => ({ db: {}, contentCycles: {}, contentCyclePosts: {}, PRE_PLANNING_STATUSES: new Set<string>() }));
vi.mock('@/lib/steps', () => ({ listStepsForPosts: async () => new Map() }));

import { beatsInMonth } from '@/lib/plan';
import { BeatMarker, beatLabel } from './BeatMarker';

describe('beatsInMonth', () => {
  const brief = {
    schedule: [
      { date: '2026-08-05', type: 'launch', product: 'Wren vest', colourway: 'sage', note: 'Wren vest goes live' },
      { date: '2026-08-21', type: 'weekend-style-guide', product: null, colourway: null, note: 'WSG' },
      { date: '2026-09-02', type: 'launch', product: 'other', colourway: null, note: 'next month' },
    ],
  };

  it('returns [] for a null / malformed brief (pre-extraction is graceful)', () => {
    expect(beatsInMonth(null, '2026-08')).toEqual([]);
    expect(beatsInMonth({}, '2026-08')).toEqual([]);
    expect(beatsInMonth({ schedule: 'nope' }, '2026-08')).toEqual([]);
  });

  it('filters to the viewed month and maps beat fields (no format field — beats are not posts)', () => {
    const beats = beatsInMonth(brief, '2026-08');
    expect(beats).toHaveLength(2);
    expect(beats.map((b) => b.date)).toEqual(['2026-08-05', '2026-08-21']);
    expect(beats[0]).toEqual({ date: '2026-08-05', type: 'launch', product: 'Wren vest', colourway: 'sage', note: 'Wren vest goes live' });
    expect(Object.keys(beats[0]!)).not.toContain('format');
  });
});

describe('BeatMarker', () => {
  const beat = { date: '2026-08-21', type: 'weekend-style-guide', product: null, colourway: null, note: 'Style the new midi' };

  it('beatLabel prefers the product, else the (de-kebabed) type', () => {
    expect(beatLabel({ ...beat, product: 'Wren vest' })).toBe('Wren vest');
    expect(beatLabel(beat)).toBe('weekend style guide');
  });

  it('renders a distinct, tap-able, read-only marker (no format tag, note in the tooltip)', () => {
    const html = renderToStaticMarkup(<BeatMarker beat={beat} onClick={() => {}} />);
    expect(html).toContain('data-testid="beat-marker"');
    expect(html).toContain('<button');                 // tap-able
    expect(html).toContain('weekend style guide');     // label
    expect(html).toContain('title="Style the new midi"'); // tap/hover surfaces the note
    expect(html).toContain('data-beat-type="weekend-style-guide"');
    // NOT a post: no format words, no post-chip testid.
    expect(html.toLowerCase()).not.toContain('reel');
    expect(html.toLowerCase()).not.toContain('carousel');
    expect(html).not.toContain('data-testid="post-chip"');
  });
});
