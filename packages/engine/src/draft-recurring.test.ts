/**
 * draft-recurring.test.ts — the client's standing commitments, and the slots they take.
 *
 * Fixtures are ivy-t's REAL configuration and REAL plan history, verbatim from UAT
 * (docs/reports/beat-grounding.md §2.4, §3c): four series, two weekly and two monthly, one
 * of them carrying a bracketed expansion, and two that file under a category whose name is
 * nothing like their own. Every one of those shapes broke a naive matcher.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveRecurringSeries, observeSeriesHistory, recurringFormatWord, seriesMatchTerms,
  seriesShortName, mentionsTerm, type PlannedPostRef,
} from './draft-recurring.js';
import { claimSeriesSlots, buildSkeleton, spreadDates } from './draft-skeleton.js';
import { observeHistory, type HistoryPost } from './draft-history.js';
import { resolvePillarWeights } from './pillar-weights.js';
import { assembleDraft, type AssembleDraftParams } from './draft-assembly.js';
import type { Pillar, RecurringSeries } from './types.js';

// ── ivy-t's live client_planning_config.recurring_series ─────────────────────

const CONFIGURED: RecurringSeries[] = [
  { name: 'Sunday Style',              dayOfWeek: 'Sunday',   time: '8pm',     format: 'Carousel', whoPosts: 'Sprigly' },
  { name: 'WSG (Weekend Style Guide)', dayOfWeek: 'Saturday', time: '6pm',     format: 'Carousel', whoPosts: 'Sally posting' },
  { name: 'Notes from the Founder',    dayOfWeek: 'monthly',  time: 'monthly', format: null,       whoPosts: 'Sally only' },
  { name: 'What our customers see',    dayOfWeek: 'monthly',  time: 'monthly', format: 'Carousel', whoPosts: 'Sprigly' },
];

/** ivy-t's live categories list — AUTHORITATIVE, and deliberately missing two series names. */
const CATEGORIES = [
  'Styling', 'WSG', 'Sunday Style', 'Brand', 'Educational',
  'Product launch or offer related', 'POV', 'Testimonials', 'Regular feature', 'No Post/Sally',
];

/** Real June/July plan rows: the two weeklies carry a matching category, the two monthlies do not. */
const HISTORY: PlannedPostRef[] = [
  { date: '2026-06-06', category: 'WSG',          title: 'WSG: Vests' },
  { date: '2026-06-11', category: 'Sunday Style', title: 'Sunday Style: Vests' },
  { date: '2026-06-23', category: 'Brand',        title: 'Notes from the Founder' },
  { date: '2026-06-28', category: 'Sunday Style', title: 'Sunday Style: Claire' },
  { date: '2026-07-19', category: 'Sunday Style', title: 'Sunday Style: Connie × 3 Colours' },
  { date: '2026-07-23', category: 'Brand',        title: 'Notes from the Founder: July' },
  { date: '2026-07-26', category: 'Sunday Style', title: 'Sunday Style: Sally Sweatshirt × 3 Colours' },
  { date: '2026-07-29', category: 'Testimonials', title: 'What Our Customers See: Connie' },
  { date: '2026-07-31', category: 'WSG',          title: 'WSG: Sally Sweatshirt Grey Marl' },
  { date: '2026-07-22', category: 'Educational',  title: 'Organic Cotton for Sensitive Skin' },
];

describe('seriesMatchTerms / mentionsTerm — what counts as naming a series', () => {
  it('treats a bracketed expansion as the same series', () => {
    expect(seriesMatchTerms('WSG (Weekend Style Guide)').sort())
      .toEqual(['WSG', 'WSG (Weekend Style Guide)', 'Weekend Style Guide'].sort());
  });

  it('anchors on non-alphanumeric boundaries, so punctuation in a name still matches', () => {
    expect(mentionsTerm('WSG (Weekend Style Guide): two looks', 'WSG (Weekend Style Guide)')).toBe(true);
    expect(mentionsTerm('WSG: two looks', 'WSG')).toBe(true);
  });

  it('does not match a name inside a longer word', () => {
    expect(mentionsTerm('WSGX: not the series', 'WSG')).toBe(false);
  });
});

describe('observeSeriesHistory — when did each series last run?', () => {
  const obs = observeSeriesHistory(CONFIGURED.map((s) => s.name), HISTORY);

  it('dates a series whose CATEGORY names it', () => {
    expect(obs.get('Sunday Style')).toEqual({ lastPlanned: '2026-07-26', monthsObserved: 2 });
  });

  it('dates a series via its bracketed short form in the category column', () => {
    expect(obs.get('WSG (Weekend Style Guide)')).toEqual({ lastPlanned: '2026-07-31', monthsObserved: 2 });
  });

  it('dates a series whose category is NOTHING like its name, from the title', () => {
    // "Notes from the Founder" files under Brand. Category-only matching would report it as
    // never run, and the draft would then have no reason to say when it last did.
    expect(obs.get('Notes from the Founder')).toEqual({ lastPlanned: '2026-07-23', monthsObserved: 2 });
    expect(obs.get('What our customers see')).toEqual({ lastPlanned: '2026-07-29', monthsObserved: 1 });
  });

  it('reports NEVER PLANNED as null, never as a zero or an epoch', () => {
    const fresh = observeSeriesHistory(['Brand New Feature'], HISTORY);
    expect(fresh.get('Brand New Feature')).toEqual({ lastPlanned: null, monthsObserved: 0 });
  });

  it('ignores posts that are not instances of any series', () => {
    const only = observeSeriesHistory(['Sunday Style'], [{ date: '2026-07-22', category: 'Educational', title: 'Organic Cotton for Sensitive Skin' }]);
    expect(only.get('Sunday Style')!.lastPlanned).toBeNull();
  });

  it('is unaffected by the order the history rows arrive in', () => {
    const reversed = observeSeriesHistory(CONFIGURED.map((s) => s.name), [...HISTORY].reverse());
    expect(reversed).toEqual(obs);
  });
});

describe('resolveRecurringSeries', () => {
  const resolved = resolveRecurringSeries(CONFIGURED, CATEGORIES, HISTORY);

  it('maps configured days to weekday numbers and monthly to null', () => {
    expect(resolved.find((s) => s.name === 'Sunday Style')!.weekday).toBe(0);
    expect(resolved.find((s) => s.name === 'WSG (Weekend Style Guide)')!.weekday).toBe(6);
    expect(resolved.find((s) => s.name === 'Notes from the Founder')!.weekday).toBeNull();
  });

  it('files a series under one of the CLIENT\'S OWN categories, or under none', () => {
    expect(resolved.find((s) => s.name === 'Sunday Style')!.category).toBe('Sunday Style');
    expect(resolved.find((s) => s.name === 'WSG (Weekend Style Guide)')!.category).toBe('WSG');
    // categories is authoritative; inventing "Notes from the Founder" as a category would put
    // a value in the column the client's configuration does not contain.
    expect(resolved.find((s) => s.name === 'Notes from the Founder')!.category).toBeNull();
  });

  it('resolves the format the config declares, and declines to invent one when it does not', () => {
    expect(recurringFormatWord('Carousel')).toBe('carousel');
    expect(recurringFormatWord('Reel')).toBe('reel');
    expect(recurringFormatWord('Static')).toBe('single');
    expect(recurringFormatWord('Reel or Carousel')).toBeNull();
    expect(recurringFormatWord(null)).toBeNull();
  });

  it('carries time and whoPosts through verbatim', () => {
    const wsg = resolved.find((s) => s.name === 'WSG (Weekend Style Guide)')!;
    expect(wsg.time).toBe('6pm');
    expect(wsg.whoPosts).toBe('Sally posting');
  });

  it('sorts by name — the config array order is a database row order', () => {
    expect(resolved.map((s) => s.name)).toEqual([...resolved.map((s) => s.name)].sort((a, b) => a.localeCompare(b)));
    const shuffled = resolveRecurringSeries([...CONFIGURED].reverse(), CATEGORIES, HISTORY);
    expect(shuffled).toEqual(resolved);
  });

  it('survives an empty history — the series place, they just carry no dates', () => {
    const noHistory = resolveRecurringSeries(CONFIGURED, CATEGORIES, []);
    expect(noHistory).toHaveLength(4);
    expect(noHistory.every((s) => s.lastPlanned === null && s.monthsObserved === 0)).toBe(true);
  });

  it('drops an unnamed configured entry rather than placing a nameless beat', () => {
    const junk = [{ ...CONFIGURED[0]!, name: '  ' }];
    expect(resolveRecurringSeries(junk, CATEGORIES, HISTORY)).toHaveLength(0);
  });
});

// ── Placement ────────────────────────────────────────────────────────────────

const SERIES = resolveRecurringSeries(CONFIGURED, CATEGORIES, HISTORY);
/** September 2026, one slot per day — ivy-t's real shape at 7.48 posts/week. */
const SEPT = spreadDates('2026-09', 30, [0, 1, 2, 3, 4, 5, 6]);

describe('claimSeriesSlots — series OCCUPY slots, never add them', () => {
  const { claims, unplaced } = claimSeriesSlots(SEPT, SERIES);

  it('puts a weekly series on every one of its weekdays in the month', () => {
    const sundays = [...claims.entries()].filter(([, s]) => s.name === 'Sunday Style').map(([i]) => SEPT[i]!);
    expect(sundays).toEqual(['2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
  });

  it('puts the Saturday series on Saturdays', () => {
    const sats = [...claims.entries()].filter(([, s]) => s.name.startsWith('WSG')).map(([i]) => SEPT[i]!);
    expect(sats).toEqual(['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26']);
  });

  it('gives each monthly series exactly one slot', () => {
    for (const name of ['Notes from the Founder', 'What our customers see']) {
      expect([...claims.values()].filter((s) => s.name === name)).toHaveLength(1);
    }
  });

  it('spaces the monthly series rather than clustering them at one end', () => {
    const at = [...claims.entries()]
      .filter(([, s]) => s.weekday === null).map(([i]) => i).sort((a, b) => a - b);
    expect(at).toHaveLength(2);
    expect(at[1]! - at[0]!).toBeGreaterThan(5);
  });

  it('NEVER double-books a slot', () => {
    const indices = [...claims.keys()];
    expect(new Set(indices).size).toBe(indices.length);
    expect(indices.every((i) => i >= 0 && i < SEPT.length)).toBe(true);
  });

  it('places everything when the month has room, and reports nothing unplaced', () => {
    expect(unplaced).toEqual([]);
    expect(claims.size).toBe(10);           // 4 Sundays + 4 Saturdays + 2 monthlies
  });

  it('reports a weekly series with NO slot on its day rather than silently dropping it', () => {
    // A Mon/Wed/Fri month has no Sunday and no Saturday.
    const mwf = spreadDates('2026-09', 13, [1, 3, 5]);
    const { claims: c, unplaced: u } = claimSeriesSlots(mwf, SERIES);
    expect(u.map((x) => x.name)).toEqual(['Sunday Style', 'WSG (Weekend Style Guide)']);
    expect([...c.values()].every((s) => s.weekday === null)).toBe(true);   // monthlies still land
  });

  it('is deterministic — same dates and series, same claims, whatever order they arrive in', () => {
    const again = claimSeriesSlots(SEPT, [...SERIES].reverse());
    expect([...again.claims.entries()].map(([i, s]) => [i, s.name]))
      .toEqual([...claims.entries()].map(([i, s]) => [i, s.name]));
  });

  it('claims nothing when no series are configured', () => {
    expect(claimSeriesSlots(SEPT, []).claims.size).toBe(0);
  });
});

// ── The skeleton's fences: slot count, formats, determinism ──────────────────

const IG: HistoryPost[] = Array.from({ length: 40 }, (_, i) => ({
  timestamp: `2026-0${(i % 3) + 5}-${String((i % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
  caption: 'x', likesCount: 40 + i, commentsCount: 2,
  mediaType: i % 3 === 0 ? 'carousel' : 'reel',
}));

const PILLARS: Pillar[] = [
  { name: 'Everyday Ritual', tagline: '', keyMessages: [], contentIdeas: [] },
  { name: 'Brand Story',     tagline: '', keyMessages: [], contentIdeas: [] },
];

const skeleton = (series?: typeof SERIES) => buildSkeleton({
  month: '2026-09', history: observeHistory(IG), pillars: resolvePillarWeights(PILLARS),
  ...(series ? { series } : {}),
});

describe('buildSkeleton with recurring series — the fences hold', () => {
  it('SLOT COUNT is unchanged: a series occupies, it never adds', () => {
    expect(skeleton(SERIES).slots).toHaveLength(skeleton().slots.length);
  });

  it('DATES are unchanged: cadence chose them before any series was consulted', () => {
    expect(skeleton(SERIES).slots.map((s) => s.date)).toEqual(skeleton().slots.map((s) => s.date));
  });

  it('PILLARS are unchanged: the pillar mix is not what a series decides', () => {
    expect(skeleton(SERIES).slots.map((s) => s.pillar)).toEqual(skeleton().slots.map((s) => s.pillar));
  });

  it('a claimed slot takes the series\' declared format', () => {
    for (const slot of skeleton(SERIES).slots.filter((s) => s.series)) {
      if (slot.series!.format) expect(slot.format).toBe(slot.series!.format);
    }
  });

  it('an UNCLAIMED slot keeps exactly the format the observed spread gave it', () => {
    const withSeries = skeleton(SERIES).slots;
    const without    = skeleton().slots;
    withSeries.forEach((s, i) => {
      if (!s.series) expect(s.format).toBe(without[i]!.format);
    });
  });

  it('leaves the format alone where the config declines to fix one', () => {
    const loose = resolveRecurringSeries(
      [{ name: 'Loose', dayOfWeek: 'Sunday', time: '8pm', format: 'Reel or Carousel', whoPosts: 'Sprigly' }],
      CATEGORIES, [],
    );
    const s = skeleton(loose);
    s.slots.forEach((slot, i) => { if (slot.series) expect(slot.format).toBe(skeleton().slots[i]!.format); });
  });

  it('is fully deterministic — the same inputs give a byte-identical skeleton', () => {
    expect(JSON.stringify(skeleton(SERIES))).toBe(JSON.stringify(skeleton(SERIES)));
  });

  it('reports unplaced series on the skeleton rather than swallowing them', () => {
    const thin = buildSkeleton({
      month: '2026-09', history: observeHistory(IG.slice(0, 20)),
      pillars: resolvePillarWeights(PILLARS), configPostsPerWeek: 3, series: SERIES,
    });
    expect(Array.isArray(thin.unplacedSeries)).toBe(true);
  });
});

// ── End to end through the assembler ─────────────────────────────────────────

const baseParams = (over: Partial<AssembleDraftParams> = {}): AssembleDraftParams => ({
  clientId: 'c', cycleId: 'cy', channel: 'instagram', month: '2026-09',
  posts: IG, pillars: PILLARS, candidates: [], temperature: null,
  hasCatalogue: true, hasBriefedLaunch: true, ...over,
});

describe('assembleDraft — a series beat says what it is', () => {
  const draft = assembleDraft(baseParams({ series: SERIES }));
  const seriesBeats = draft.beats.filter((b) => b.beatMeta.rationaleEvidence.seriesDue);

  it('titles the beat for its series, deterministically — phrasing may never run', () => {
    const sunday = seriesBeats.find((b) => b.beatMeta.rationaleEvidence.seriesDue!.name === 'Sunday Style')!;
    expect(sunday.title).toBe('Sunday Style — Carousel');
  });

  it('titles a series beat by the client\'s SHORTHAND, not the bracketed config name', () => {
    // A full month, so the Saturday series has a slot to sit on at all.
    const full = assembleDraft(baseParams({ series: SERIES, floorSlots: 30 }));
    const wsg = full.beats.find((b) => b.beatMeta.rationaleEvidence.seriesDue?.name.startsWith('WSG'))!;
    expect(wsg.title).toBe('WSG — Carousel');
    expect(wsg.title).not.toContain('Weekend Style Guide');
  });

  it('keeps the format suffix on a series beat with NO product — four Sundays must differ', () => {
    // Nothing else distinguishes them, so the suffix is still doing its one job.
    const sunday = seriesBeats.find((b) => b.beatMeta.rationaleEvidence.seriesDue!.name === 'Sunday Style')!;
    expect(sunday.title.endsWith(' — Carousel')).toBe(true);
  });

  it('carries the series evidence: name, day, when it last ran, over how many months', () => {
    const sunday = seriesBeats.find((b) => b.beatMeta.rationaleEvidence.seriesDue!.name === 'Sunday Style')!;
    expect(sunday.beatMeta.rationaleEvidence.seriesDue).toEqual({
      name: 'Sunday Style', dayOfWeek: 'Sunday', lastPlanned: '2026-07-26', monthsObserved: 2,
    });
  });

  it('writes the columns the old planner wrote — category, whoPosts, postingTime', () => {
    const sunday = seriesBeats.find((b) => b.beatMeta.rationaleEvidence.seriesDue!.name === 'Sunday Style')!;
    expect(sunday.sourceMeta).toEqual({ category: 'Sunday Style', whoPosts: 'Sprigly', postingTime: '8pm' });
  });

  it('omits a category it cannot honestly supply rather than inventing one', () => {
    const notes = seriesBeats.find((b) => b.beatMeta.rationaleEvidence.seriesDue!.name === 'Notes from the Founder')!;
    expect(notes.sourceMeta!.category).toBeUndefined();
    expect(notes.sourceMeta!.whoPosts).toBe('Sally only');
  });

  it('gives a non-series beat NO sourceMeta at all', () => {
    const plain = draft.beats.find((b) => !b.beatMeta.rationaleEvidence.seriesDue)!;
    expect(plain.sourceMeta).toBeUndefined();
  });

  it('never puts an experiment on a slot a series already claimed', () => {
    const withIdeas = assembleDraft(baseParams({
      series: SERIES, temperature: 1,
      candidates: Array.from({ length: 30 }, (_, i) => ({ id: `pi-${i}`, content: `idea ${i}`, origin: 'client' as const, lifecycle: 'candidate' })),
    }));
    for (const b of withIdeas.beats) {
      const ev = b.beatMeta.rationaleEvidence;
      expect(ev.seriesDue !== undefined && ev.candidateRank !== undefined).toBe(false);
    }
    // And the month is still full — nothing was dropped to avoid the collision.
    expect(withIdeas.beats).toHaveLength(draft.beats.length);
  });

  it('keeps the beat count and the dates identical to a month with no series', () => {
    const none = assembleDraft(baseParams());
    expect(draft.beats.map((b) => b.scheduledDate)).toEqual(none.beats.map((b) => b.scheduledDate));
  });
});

// ── The client's own shorthand (T2a) ─────────────────────────────────────────

describe('seriesShortName — a title calls it what she calls it', () => {
  it('takes the form before the bracket', () => {
    // Her config carries both forms in one string. Every month she has run titles it "WSG:
    // Vests", "WSG: Connie Violet", "WSG: Maggie Almond"; her categories list holds "WSG";
    // postingTimes holds `wsg`. Three places in her own configuration agree.
    expect(seriesShortName('WSG (Weekend Style Guide)')).toBe('WSG');
  });

  it('leaves a name that is already short alone', () => {
    expect(seriesShortName('Sunday Style')).toBe('Sunday Style');
    expect(seriesShortName('Notes from the Founder')).toBe('Notes from the Founder');
  });

  it('does not strip a bracket that is not a trailing expansion', () => {
    expect(seriesShortName('Style (Sunday) Notes')).toBe('Style (Sunday) Notes');
  });

  it('never returns empty — a name that is ONLY a bracket keeps its full form', () => {
    expect(seriesShortName('(Weekend Style Guide)')).toBe('(Weekend Style Guide)');
  });

  it('is carried on the resolved series alongside the full name', () => {
    const wsg = resolveRecurringSeries(CONFIGURED, CATEGORIES, HISTORY)
      .find((s) => s.name.startsWith('WSG'))!;
    expect(wsg.name).toBe('WSG (Weekend Style Guide)');
    expect(wsg.shortName).toBe('WSG');
    // The full name still governs matching and the phrasing licence — only titles shorten.
    expect(wsg.category).toBe('WSG');
  });
});
