import { describe, it, expect } from 'vitest';
import { observeCadence, observeFormats, observeHistory, type HistoryPost } from './draft-history.js';
import { resolvePillarWeights, spreadPillars } from './pillar-weights.js';
import { buildSkeleton, spreadDates, spreadFormats, slotCountFor, DRAFT_MIN_POSTS } from './draft-skeleton.js';
import { allocateSlots, rankCandidates, type ExperimentCandidate } from './draft-allocator.js';
import { assembleDraft, detectAssumptions, type AssembleDraftParams } from './draft-assembly.js';
import type { Pillar } from './types.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Modelled on earl-of-east's real shape (31 posts, image-heavy, zero reels) so the
// tests exercise the same conditions the sandbox client actually presents.

const post = (date: string, mediaType: string | undefined, likes: number, comments = 0): HistoryPost => ({
  timestamp: `${date}T10:00:00.000Z`, caption: 'x', likesCount: likes, commentsCount: comments,
  ...(mediaType ? { mediaType } : {}),
});

/** 20 posts across two months: 14 image, 6 carousel, no reels. Carousels engage higher. */
const HISTORY: HistoryPost[] = [
  ...Array.from({ length: 14 }, (_, i) => post(`2026-05-${String((i % 28) + 1).padStart(2, '0')}`, 'image', 30 + i)),
  ...Array.from({ length: 6 },  (_, i) => post(`2026-06-${String((i % 28) + 1).padStart(2, '0')}`, 'carousel', 70 + i, 3)),
];

const PILLARS: Pillar[] = [
  { name: 'Product & Fragrance', tagline: '', keyMessages: [], contentIdeas: [], sharePct: 50 },
  { name: 'Everyday Ritual',     tagline: '', keyMessages: [], contentIdeas: [], sharePct: 30 },
  { name: 'Brand Story',         tagline: '', keyMessages: [], contentIdeas: [], sharePct: 20 },
];

/** Pre-Build-A config: no sharePct anywhere. Must stay valid. */
const LEGACY_PILLARS: Pillar[] = PILLARS.map(({ sharePct: _drop, ...p }) => p);

const baseParams = (over: Partial<AssembleDraftParams> = {}): AssembleDraftParams => ({
  clientId: 'client-1', cycleId: 'cycle-1', channel: 'instagram', month: '2026-09',
  posts: HISTORY, pillars: PILLARS, candidates: [], temperature: null,
  hasCatalogue: true, hasBriefedLaunch: true, ...over,
});

// ── Observations ─────────────────────────────────────────────────────────────

describe('observeHistory — deterministic observations from stored ig_posts', () => {
  it('computes per-format share and engagement over TYPED posts only', () => {
    const { formats, coverage } = observeFormats(HISTORY);
    expect(coverage).toEqual({ typed: 20, total: 20 });
    const image = formats.find((f) => f.format === 'single')!;
    const carousel = formats.find((f) => f.format === 'carousel')!;
    expect(image.posts).toBe(14);
    expect(carousel.posts).toBe(6);
    expect(carousel.avgEngagement).toBeGreaterThan(image.avgEngagement);
  });

  it('OMITS a format the client has never posted rather than reporting it as zero', () => {
    // earl-of-east has posted no reels. "No reels observed" and "reels scored zero" are
    // different claims; the assembler must never be handed the second one.
    const { formats } = observeFormats(HISTORY);
    expect(formats.map((f) => f.format)).not.toContain('reel');
  });

  it('reports partial mediaType coverage instead of silently narrowing the denominator', () => {
    // ivy-t's real shape: only the most recent month carries mediaType.
    const mixed = [...HISTORY.slice(0, 10), post('2026-04-01', undefined, 20), post('2026-04-02', undefined, 25)];
    const { coverage } = observeFormats(mixed);
    expect(coverage).toEqual({ typed: 10, total: 12 });
  });

  it('derives cadence and the weekdays actually posted on', () => {
    const cadence = observeCadence(HISTORY);
    expect(cadence.postCount).toBe(20);
    expect(cadence.months).toBe(2);
    expect(cadence.postsPerWeek).toBeGreaterThan(0);
    expect(cadence.weekdays.length).toBeGreaterThan(0);
  });

  it('degrades to zeroes on empty history rather than throwing', () => {
    expect(observeCadence([])).toEqual({ postsPerWeek: 0, postCount: 0, months: 0, weekdays: [] });
    expect(observeHistory([]).totalPosts).toBe(0);
  });
});

// ── Pillar weights (Part 2 substrate) ────────────────────────────────────────

describe('resolvePillarWeights — pre-Build-A configs stay valid', () => {
  it('uses stored sharePct when present, normalised to 1', () => {
    const { weights, basis } = resolvePillarWeights(PILLARS);
    expect(basis).toBe('derived');
    expect(weights.reduce((s, w) => s + w.share, 0)).toBeCloseTo(1, 10);
    expect(weights.find((w) => w.name === 'Product & Fragrance')!.share).toBeCloseTo(0.5, 10);
  });

  it('falls back to EQUAL shares for a config written before sharePct existed', () => {
    const { weights, basis } = resolvePillarWeights(LEGACY_PILLARS);
    expect(basis).toBe('equal');
    expect(weights).toHaveLength(3);
    for (const w of weights) expect(w.share).toBeCloseTo(1 / 3, 10);
  });

  it('treats an all-zero-share config as equal, not as "every pillar weighs nothing"', () => {
    const zeroed = PILLARS.map((p) => ({ ...p, sharePct: 0 }));
    expect(resolvePillarWeights(zeroed).basis).toBe('equal');
  });

  it('is order-independent — stored array order cannot change the weights', () => {
    const a = resolvePillarWeights(PILLARS);
    const b = resolvePillarWeights([...PILLARS].reverse());
    expect(a).toEqual(b);
  });
});

describe('spreadPillars — largest-remainder, exact totals', () => {
  it('allocates exactly slotCount slots', () => {
    for (const n of [1, 7, 12, 13, 30]) {
      expect(spreadPillars(resolvePillarWeights(PILLARS).weights, n)).toHaveLength(n);
    }
  });

  it('honours the weights', () => {
    const out = spreadPillars(resolvePillarWeights(PILLARS).weights, 10);
    expect(out.filter((p) => p === 'Product & Fragrance')).toHaveLength(5);
    expect(out.filter((p) => p === 'Everyday Ritual')).toHaveLength(3);
    expect(out.filter((p) => p === 'Brand Story')).toHaveLength(2);
  });

  it('interleaves rather than grouping, so a month does not open with one pillar five times', () => {
    const out = spreadPillars(resolvePillarWeights(PILLARS).weights, 10);
    expect(new Set(out.slice(0, 3)).size).toBeGreaterThan(1);
  });
});

// ── Allocator (D4) ───────────────────────────────────────────────────────────

const CANDIDATES: ExperimentCandidate[] = [
  { id: 'c-competitor', content: 'competitor idea', origin: 'competitor', engagement: 500 },
  { id: 'a-client',     content: 'client idea A',   origin: 'client' },
  { id: 'b-client',     content: 'client idea B',   origin: 'client' },
];

describe('allocateSlots — the temperature dial', () => {
  it('temperature null → all proven (the day-one path)', () => {
    const slots = allocateSlots(10, null, CANDIDATES);
    expect(slots).toHaveLength(10);
    expect(slots.every((s) => s.slotType === 'proven')).toBe(true);
  });

  it('temperature 0 → all proven', () => {
    expect(allocateSlots(10, 0, CANDIDATES).every((s) => s.slotType === 'proven')).toBe(true);
  });

  it('EMPTY backlog with any temperature → a full proven month, never an empty one', () => {
    // loadDurableInputs returns [] for every client today (all live plan_inputs rows are
    // type='note', which it filters out). This is the expected day-one path.
    const slots = allocateSlots(12, 1, []);
    expect(slots).toHaveLength(12);
    expect(slots.every((s) => s.slotType === 'proven')).toBe(true);
  });

  it('temperature 1 with a surplus of candidates → every slot experimental, none duplicated', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `id-${i}`, content: `idea ${i}`, origin: 'client' as const }));
    const slots = allocateSlots(5, 1, many);
    expect(slots.every((s) => s.slotType === 'experiment')).toBe(true);
    expect(new Set(slots.map((s) => s.candidate!.id)).size).toBe(5);
  });

  it('candidate SHORTAGE: unfilled experimental slots revert to proven', () => {
    const slots = allocateSlots(10, 1, CANDIDATES.slice(0, 2));
    expect(slots.filter((s) => s.slotType === 'experiment')).toHaveLength(2);
    expect(slots.filter((s) => s.slotType === 'proven')).toHaveLength(8);
  });

  it('rounds temperature × slots', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `id-${i}`, content: 'x', origin: 'client' as const }));
    expect(allocateSlots(10, 0.25, many).filter((s) => s.slotType === 'experiment')).toHaveLength(3);
    expect(allocateSlots(10, 0.5,  many).filter((s) => s.slotType === 'experiment')).toHaveLength(5);
  });

  it('ranks client ideas above competitor ones regardless of engagement', () => {
    const ranked = rankCandidates(CANDIDATES);
    expect(ranked.map((c) => c.id)).toEqual(['a-client', 'b-client', 'c-competitor']);
  });

  it('spaces experiments through the month rather than front-loading them', () => {
    const slots = allocateSlots(10, 0.2, CANDIDATES);
    const at = slots.filter((s) => s.slotType === 'experiment').map((s) => s.index);
    expect(at).toHaveLength(2);
    expect(at[0]).toBeGreaterThan(0);        // not slot 0
    expect(at[1]! - at[0]!).toBeGreaterThan(1);
  });
});

// ── Skeleton determinism ─────────────────────────────────────────────────────

describe('buildSkeleton — determinism', () => {
  const build = () => buildSkeleton({
    month: '2026-09', history: observeHistory(HISTORY), pillars: resolvePillarWeights(PILLARS),
  });

  it('same inputs → byte-identical skeleton', () => {
    expect(build()).toEqual(build());
  });

  it('is independent of the input array order', () => {
    const a = buildSkeleton({ month: '2026-09', history: observeHistory(HISTORY), pillars: resolvePillarWeights(PILLARS) });
    const b = buildSkeleton({ month: '2026-09', history: observeHistory([...HISTORY].reverse()), pillars: resolvePillarWeights([...PILLARS].reverse()) });
    expect(a.slots).toEqual(b.slots);
  });

  it('places every slot inside the planned month, in ascending date order', () => {
    const { slots } = build();
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(s.date.startsWith('2026-09')).toBe(true);
    const dates = slots.map((s) => s.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('tilts the format mix toward engagement but never eliminates an observed format', () => {
    // Carousels engage ~2x higher here; images are 70% of posts. Both must survive.
    const formats = new Set(build().slots.map((s) => s.format));
    expect(formats.has('single')).toBe(true);
    expect(formats.has('carousel')).toBe(true);
  });

  it('slotCountFor scales with cadence and stays inside the month', () => {
    expect(slotCountFor('2026-09', 3)).toBeGreaterThan(slotCountFor('2026-09', 1));
    expect(slotCountFor('2026-09', 100)).toBeLessThanOrEqual(30);
    expect(slotCountFor('2026-09', 0)).toBe(1);
  });

  it('spreadDates never returns a date outside the month', () => {
    for (const d of spreadDates('2026-02', 12, [1, 3, 5])) {
      expect(d >= '2026-02-01' && d <= '2026-02-28').toBe(true);
    }
  });

  it('spreadFormats falls back to a neutral mix when nothing was observed', () => {
    const out = spreadFormats([], 10);
    expect(out).toHaveLength(10);
    expect(new Set(out).size).toBeGreaterThan(1);
  });
});

// ── Thin-data fallback ───────────────────────────────────────────────────────

describe('thin-data fallback — honest evidence, never fabricated metrics', () => {
  const thin = HISTORY.slice(0, DRAFT_MIN_POSTS - 1);

  it('engages below the floor and says why', () => {
    const skeleton = buildSkeleton({ month: '2026-09', history: observeHistory(thin), pillars: resolvePillarWeights(PILLARS) });
    expect(skeleton.basis).toBe('template');
    expect(skeleton.reason).toContain('insufficient history');
    expect(skeleton.slots.length).toBeGreaterThan(0);      // still produces a full month
  });

  it('does NOT engage at exactly the floor', () => {
    const atFloor = [...HISTORY.slice(0, DRAFT_MIN_POSTS)];
    expect(buildSkeleton({ month: '2026-09', history: observeHistory(atFloor), pillars: resolvePillarWeights(PILLARS) }).basis).toBe('observed');
  });

  it('template beats carry NO invented metrics — only the declared basis', () => {
    const draft = assembleDraft(baseParams({ posts: thin }));
    expect(draft.basis).toBe('template');
    for (const beat of draft.beats) {
      const ev = beat.beatMeta.rationaleEvidence;
      expect(ev.basis).toBe('template');
      expect(ev.reason).toBeTruthy();
      expect(ev.formatEngagement).toBeUndefined();   // the crux: no fabricated engagement
      expect(ev.pillarShare).toBeUndefined();
    }
  });

  it('falls back with zero history without throwing', () => {
    const draft = assembleDraft(baseParams({ posts: [] }));
    expect(draft.basis).toBe('template');
    expect(draft.beats.length).toBeGreaterThan(0);
  });
});

// ── assembleDraft end to end ─────────────────────────────────────────────────

describe('assembleDraft', () => {
  it('is deterministic — same inputs, byte-identical draft', () => {
    expect(assembleDraft(baseParams())).toEqual(assembleDraft(baseParams()));
  });

  it('grounds every observed beat in real, structured evidence', () => {
    const draft = assembleDraft(baseParams());
    expect(draft.basis).toBe('observed');
    for (const beat of draft.beats) {
      const ev = beat.beatMeta.rationaleEvidence;
      expect(ev.basis).toBe('observed');
      expect(ev.cadenceBasis.postsPerWeek).toBeGreaterThan(0);
      expect(ev.formatEngagement!.posts).toBeGreaterThan(0);
      expect(typeof ev.pillarShare).toBe('number');
      // Structured refs only — no prose smuggled into the evidence.
      expect(typeof ev).toBe('object');
      expect(ev.formatEngagement!.format).toBe(beat.format);
    }
  });

  it('gives every beat a non-empty deterministic title before any phrasing pass', () => {
    for (const beat of assembleDraft(baseParams()).beats) {
      expect(beat.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('marks all slots proven with an empty backlog (day-one path)', () => {
    const draft = assembleDraft(baseParams({ temperature: 1, candidates: [] }));
    expect(draft.beats.every((b) => b.beatMeta.slotType === 'proven')).toBe(true);
    expect(draft.beats.every((b) => b.beatMeta.sourceRef === undefined)).toBe(true);
  });

  it('links an experiment beat back to the plan_inputs row it came from', () => {
    const draft = assembleDraft(baseParams({ temperature: 0.2, candidates: CANDIDATES }));
    const experiments = draft.beats.filter((b) => b.beatMeta.slotType === 'experiment');
    expect(experiments.length).toBeGreaterThan(0);
    for (const e of experiments) {
      expect(e.beatMeta.sourceRef).toBeTruthy();
      expect(e.beatMeta.rationaleEvidence.candidateRank!.of).toBe(CANDIDATES.length);
    }
  });

  it('consumes client ideas before competitor ones', () => {
    // 3 candidates (2 client, 1 competitor); this cadence yields enough slots that
    // temperature 0.2 takes all three, so rank order is what proves the preference.
    const draft = assembleDraft(baseParams({ temperature: 0.2, candidates: CANDIDATES }));
    const byRank = draft.beats
      .filter((b) => b.beatMeta.slotType === 'experiment')
      .map((b) => b.beatMeta.rationaleEvidence.candidateRank!)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => r.origin);
    // Every client-origin idea is used before any competitor-origin one.
    expect(byRank.lastIndexOf('client')).toBeLessThan(byRank.indexOf('competitor'));
  });

  it('positions are contiguous from zero, so the beats have a stable order', () => {
    const draft = assembleDraft(baseParams());
    expect(draft.beats.map((b) => b.position)).toEqual(draft.beats.map((_, i) => i));
  });
});

// ── Assumptions ──────────────────────────────────────────────────────────────

describe('detectAssumptions — the gaps that become intake questions', () => {
  const skeleton = () => buildSkeleton({ month: '2026-09', history: observeHistory(HISTORY), pillars: resolvePillarWeights(PILLARS) });

  it('is silent when nothing is missing', () => {
    expect(detectAssumptions({
      history: observeHistory(HISTORY), hasCatalogue: true, hasBriefedLaunch: true, skeleton: skeleton(),
    })).toEqual([]);
  });

  it('flags a missing launch and a missing catalogue', () => {
    const out = detectAssumptions({
      history: observeHistory(HISTORY), hasCatalogue: false, hasBriefedLaunch: false, skeleton: skeleton(),
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/launches or restocks/i);
    expect(out[1]).toMatch(/catalogue/i);
  });

  it('flags equal-share pillars when the config predates sharePct', () => {
    const out = detectAssumptions({
      history: observeHistory(HISTORY), hasCatalogue: true, hasBriefedLaunch: true,
      skeleton: buildSkeleton({ month: '2026-09', history: observeHistory(HISTORY), pillars: resolvePillarWeights(LEGACY_PILLARS) }),
    });
    expect(out.some((a) => /evenly across pillars/i.test(a))).toBe(true);
  });

  it('flags partial format coverage with the real numbers', () => {
    const mixed = [...HISTORY, post('2026-04-01', undefined, 20), post('2026-04-02', undefined, 25)];
    const out = detectAssumptions({
      history: observeHistory(mixed), hasCatalogue: true, hasBriefedLaunch: true,
      skeleton: buildSkeleton({ month: '2026-09', history: observeHistory(mixed), pillars: resolvePillarWeights(PILLARS) }),
    });
    expect(out.some((a) => a.includes('20 of 22'))).toBe(true);
  });

  it('attaches the assumptions to every beat, so a beat is never read without its caveats', () => {
    const draft = assembleDraft(baseParams({ hasCatalogue: false, hasBriefedLaunch: false }));
    expect(draft.assumptions.length).toBeGreaterThan(0);
    for (const beat of draft.beats) {
      expect(beat.beatMeta.assumptions).toEqual(draft.assumptions);
    }
  });
});
