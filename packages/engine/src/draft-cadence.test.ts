/**
 * draft-cadence.test.ts — a client's stated cadence is a FLOOR that outranks their history.
 *
 * "7 posts a week", "post every day", "at least 20 this month" were inexpressible: the
 * assembler derived slots from observed cadence and the client could not override it by
 * telling. Now a kind:'cadence' intent sets a floor — the assembler is held to at least it on
 * future assembly, and a LIVE draft is topped up on the spot. Nothing is ever removed: a
 * decrease only records the floor and hands the removal to the client, whose posts they are.
 */
import { describe, it, expect } from 'vitest';
import { applyCadence, applyIntent, type TransformBeat } from './draft-transforms.js';
import { cadenceFloorSlots, buildSkeleton } from './draft-skeleton.js';
import { observeHistory, type HistoryPost } from './draft-history.js';
import { resolvePillarWeights } from './pillar-weights.js';
import type { MonthScopedIntent } from './intake-classify.js';
import type { BeatMeta } from '@sprigly/db';
import type { Pillar } from './types.js';

const MONTH = '2026-08';   // 31 days
const TODAY = '2026-07-27';

const observed = (posts: number, format = 'carousel'): BeatMeta => ({
  slotType: 'proven',
  rationaleEvidence: { basis: 'observed', formatEngagement: { format, avgEngagement: 40, posts } },
});
const beat = (id: string, date: string, format = 'carousel', meta: BeatMeta | null = observed(6, 'carousel')): TransformBeat =>
  ({ id, date, format, pillar: 'Everyday Ritual', title: `Beat ${id}`, position: Number(id.replace(/\D/g, '')) || 0, beatMeta: meta });

/** A 24-beat August on 24 distinct days, leaving exactly these 7 days empty. */
const EMPTY_DAYS = ['2026-08-04', '2026-08-09', '2026-08-14', '2026-08-19', '2026-08-24', '2026-08-28', '2026-08-31'];
const august24 = (): TransformBeat[] => {
  const empty = new Set(EMPTY_DAYS.map((d) => d.slice(8)));
  const out: TransformBeat[] = [];
  for (let d = 1; d <= 31 && out.length < 24; d++) {
    const dd = String(d).padStart(2, '0');
    if (empty.has(dd)) continue;
    out.push(beat(`b${d}`, `2026-08-${dd}`, d % 3 === 0 ? 'reel' : 'carousel'));
  }
  return out;
};

const cadence = (over: Partial<MonthScopedIntent>): MonthScopedIntent =>
  ({ kind: 'cadence', subject: 'cadence', sourceText: 'a cadence', ...over });

const adds = (r: { ops: Array<{ op: string; date?: string; format?: string }> }) => r.ops.filter((o) => o.op === 'add');
const removes = (r: { ops: Array<{ op: string }> }) => r.ops.filter((o) => o.op === 'remove');

// ── The floor arithmetic ────────────────────────────────────────────────────────

describe('cadenceFloorSlots', () => {
  it('scales a weekly figure to the month (7/week fills a 31-day August)', () => {
    expect(cadenceFloorSlots(MONTH, { postsPerWeek: 7 })).toBe(31);
  });
  it('takes a monthly figure as-is, clamped to the day-count', () => {
    expect(cadenceFloorSlots(MONTH, { postsPerMonth: 20 })).toBe(20);
    expect(cadenceFloorSlots(MONTH, { postsPerMonth: 99 })).toBe(31);
  });
  it('takes the larger when both are given — the binding floor', () => {
    expect(cadenceFloorSlots(MONTH, { postsPerWeek: 3, postsPerMonth: 20 })).toBe(20);
  });
});

// ── FIXTURE — "we want 7 posts a week" on a 24-beat August ───────────────────────

describe('applyCadence — top up a live draft to the floor', () => {
  it('adds the gap and lands each new beat on an empty day, right across the month', () => {
    const before = august24();
    expect(before).toHaveLength(24);
    const res = applyCadence(cadence({ postsPerWeek: 7, subject: '7 posts a week', sourceText: 'we want 7 posts a week' }), before, MONTH);

    expect(removes(res)).toHaveLength(0);                     // never displaces anything
    const added = adds(res);
    expect(added).toHaveLength(31 - 24);                     // top up to the floor
    // The thinnest days ARE the seven empty ones — nothing stacks onto an occupied day.
    expect(new Set(added.map((o) => o.date))).toEqual(new Set(EMPTY_DAYS));
    expect(res.note).toBe('Added 7 posts to reach 7 a week, as you asked.');
  });

  it('marks every added beat as the client’s input, with honest observed engagement', () => {
    const res = applyCadence(cadence({ postsPerWeek: 7, sourceText: 'we want 7 posts a week' }), august24(), MONTH);
    for (const op of adds(res)) {
      const meta = (op as unknown as { beatMeta: BeatMeta }).beatMeta;
      expect(meta.rationaleEvidence.basis).toBe('client_input');
      expect(meta.rationaleEvidence.reason).toBe('we want 7 posts a week');
      // format engagement, when the month has it for that format, is COPIED not invented
      const fe = meta.rationaleEvidence.formatEngagement;
      if (fe) expect(fe.posts).toBeGreaterThan(0);
    }
  });

  it('"post every day" behaves as 7 a week (postsPerWeek=7)', () => {
    const res = applyCadence(cadence({ postsPerWeek: 7, subject: 'post every day', sourceText: 'post every day' }), august24(), MONTH);
    expect(adds(res)).toHaveLength(7);
  });

  it('reaches an exact monthly floor', () => {
    const before = august24();  // 24 beats
    const res = applyCadence(cadence({ postsPerMonth: 28, sourceText: 'at least 28 this month' }), before, MONTH);
    expect(adds(res)).toHaveLength(4);
    expect(res.note).toBe('Added 4 posts to reach 28 this month, as you asked.');
  });
});

// ── FIXTURE — "no more than 4 a week": a DECREASE is floor-only ──────────────────

describe('applyCadence — a decrease records the floor and removes nothing', () => {
  it('adds nothing and returns an honest receipt', () => {
    const before = august24();  // 24 beats; 4/week floor ≈ 18 < 24
    const res = applyCadence(cadence({ postsPerWeek: 4, subject: 'no more than 4 a week', sourceText: 'no more than 4 a week' }), before, MONTH);
    expect(res.ops).toHaveLength(0);
    expect(res.note).toContain('Recorded 4 a week as your floor');
    expect(res.note).toContain('24 posts');
    expect(res.note).toContain('drop the ones you don’t want');
  });

  it('an already-met floor is also a no-op with a receipt', () => {
    const res = applyCadence(cadence({ postsPerWeek: 5, sourceText: 'about 5 a week' }), august24(), MONTH);
    expect(res.ops).toHaveLength(0);   // 5/week ≈ 22 < 24
    expect(res.note).toContain('Recorded 5 a week as your floor');
  });
});

// ── clientTouched interaction — a top-up never displaces anything ────────────────

describe('applyCadence — never touches what the client placed', () => {
  it('leaves clientTouched beats alone; the ops are pure additions', () => {
    const touched: BeatMeta = { ...observed(6), clientTouched: true };
    const before = august24().map((b, i) => (i < 5 ? { ...b, beatMeta: touched } : b));
    const res = applyIntent(cadence({ postsPerWeek: 7, sourceText: 'we want 7 posts a week' }), before, MONTH, TODAY);
    // Only adds — no remove, no update — so no existing beat (touched or not) can be evicted.
    expect(res.ops.every((o) => o.op === 'add')).toBe(true);
    expect(adds(res)).toHaveLength(7);
  });
});

// ── Future assembly honours the floor ────────────────────────────────────────────

describe('buildSkeleton — a stated floor raises the slot count', () => {
  // 20 posts spread ~1 a week across five months — well below a 7/week floor, and above the
  // observed-basis floor (DRAFT_MIN_POSTS) so the count is a real observation, not the template.
  const HISTORY: HistoryPost[] = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].flatMap((mo, m) =>
    ['03', '10', '17', '24'].map((d, i) => ({
      timestamp: `${mo}-${d}T10:00:00.000Z`,
      caption: 'x', likesCount: 30 + m * 4 + i, commentsCount: 1, mediaType: 'carousel',
    })),
  );
  const PILLARS: Pillar[] = [{ name: 'Everyday Ritual', tagline: '', keyMessages: [], contentIdeas: [], sharePct: 100 }];

  it('lifts the observed count up to the floor, never above the month', () => {
    const floor = cadenceFloorSlots(MONTH, { postsPerWeek: 7 });   // 31
    const withFloor = buildSkeleton({ month: MONTH, history: observeHistory(HISTORY), pillars: resolvePillarWeights(PILLARS), floorSlots: floor });
    const noFloor   = buildSkeleton({ month: MONTH, history: observeHistory(HISTORY), pillars: resolvePillarWeights(PILLARS) });
    expect(withFloor.slots.length).toBe(31);
    expect(withFloor.slots.length).toBeGreaterThan(noFloor.slots.length);
  });

  it('a floor BELOW the observed count does not lower it', () => {
    const noFloor  = buildSkeleton({ month: MONTH, history: observeHistory(HISTORY), pillars: resolvePillarWeights(PILLARS) });
    const lowFloor = buildSkeleton({ month: MONTH, history: observeHistory(HISTORY), pillars: resolvePillarWeights(PILLARS), floorSlots: 1 });
    expect(lowFloor.slots.length).toBe(noFloor.slots.length);
  });
});
