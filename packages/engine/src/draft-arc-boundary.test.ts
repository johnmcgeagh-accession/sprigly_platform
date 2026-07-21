/**
 * draft-arc-boundary.test.ts — a launch arc never puts two of its own beats on one day.
 *
 * ivy-t's rehearsal: "New mini-series starting early August" anchored a launch on 1 Aug, and
 * clampToMonth pinned the tease's -5 offset forward onto the launch. The receipt read:
 *     Added: … — Tease,  Sat 1 Aug
 *     Added: … — Launch, Sat 1 Aug
 * Two beats of one arc, same day (docs/reports/ivy-t-rehearsal-failures.md F2). The collision
 * condition is exactly `anchor == month-start`, and "early <month>" is the commonest phrasing
 * a client uses — so the boundary case is the normal case, not the edge.
 */
import { describe, it, expect } from 'vitest';
import { applyLaunchArc, type TransformBeat } from './draft-transforms.js';
import type { MonthScopedIntent } from './intake-classify.js';
import type { BeatMeta } from '@sprigly/db';

const MONTH = '2026-08';
const observed = (posts: number): BeatMeta => ({
  slotType: 'proven',
  rationaleEvidence: { basis: 'observed', formatEngagement: { format: 'reel', avgEngagement: 40, posts } },
});
const roomyMonth = (): TransformBeat[] =>
  ['08-05', '08-08', '08-11', '08-16', '08-18', '08-20', '08-23', '08-26']
    .map((d, i) => ({ id: `b${i}`, date: `2026-${d}`, format: 'reel', pillar: 'P', title: `Beat ${i}`, position: 0, beatMeta: observed(i + 2) }));

const at = (start: string): MonthScopedIntent => ({
  kind: 'launch', subject: 'The Navy Edit', sourceText: 'launch text',
  dateRange: { start, end: start },
});

/** [label, date] for each add, in op order. */
const arc = (start: string) =>
  applyLaunchArc(at(start), roomyMonth(), MONTH).ops
    .filter((o): o is Extract<typeof o, { op: 'add' }> => o.op === 'add')
    .map((o) => [o.title.replace('The Navy Edit — ', ''), o.date] as const);

describe('arc dates are always distinct and correctly ordered', () => {
  it('THE REHEARSAL CASE — anchor on the 1st: the tease is DROPPED, not stacked', () => {
    expect(arc('2026-08-01')).toEqual([['Launch', '2026-08-01'], ['Follow-up', '2026-08-04']]);
  });

  it('and says why, rather than quietly shipping a two-part arc', () => {
    const r = applyLaunchArc(at('2026-08-01'), roomyMonth(), MONTH);
    expect(r.note).toContain('no room for a tease');
  });

  it('anchor on the 3rd: the clamped tease still fits before the launch, so it keeps the 1st', () => {
    // -5 clamps to the 1st, which is already strictly before the 3rd — no collision, so no
    // shift. Clamping is only a problem when it lands ON the launch.
    expect(arc('2026-08-03')).toEqual([
      ['Tease', '2026-08-01'], ['Launch', '2026-08-03'], ['Follow-up', '2026-08-06'],
    ]);
  });

  it('anchor on the 2nd: tease keeps the 1st — the last day that still fits', () => {
    expect(arc('2026-08-02')).toEqual([
      ['Tease', '2026-08-01'], ['Launch', '2026-08-02'], ['Follow-up', '2026-08-05'],
    ]);
  });

  it('anchor on the 6th and later: the full -5/0/+3 shape, unchanged', () => {
    expect(arc('2026-08-06')).toEqual([
      ['Tease', '2026-08-01'], ['Launch', '2026-08-06'], ['Follow-up', '2026-08-09'],
    ]);
    expect(arc('2026-08-28')).toEqual([
      ['Tease', '2026-08-23'], ['Launch', '2026-08-28'], ['Follow-up', '2026-08-31'],
    ]);
  });

  it('MIRROR — anchor on the last day: the follow-up is dropped and said', () => {
    expect(arc('2026-08-31')).toEqual([['Tease', '2026-08-26'], ['Launch', '2026-08-31']]);
    expect(applyLaunchArc(at('2026-08-31'), roomyMonth(), MONTH).note).toContain('follow-up moves to next month');
  });

  it('MIRROR — anchor on the 30th: the follow-up shifts to the 31st', () => {
    expect(arc('2026-08-30')).toEqual([
      ['Tease', '2026-08-25'], ['Launch', '2026-08-30'], ['Follow-up', '2026-08-31'],
    ]);
  });

  it('no arc EVER places two of its own beats on one date, across every anchor in the month', () => {
    for (let d = 1; d <= 31; d++) {
      const start = `2026-08-${String(d).padStart(2, '0')}`;
      const dates = arc(start).map(([, date]) => date);
      expect(new Set(dates).size, `anchor ${start} produced a collision: ${dates.join(', ')}`).toBe(dates.length);
    }
  });

  it('and never places a tease after its launch, or a follow-up before it', () => {
    for (let d = 1; d <= 31; d++) {
      const start = `2026-08-${String(d).padStart(2, '0')}`;
      const parts = new Map(arc(start));
      const launch = parts.get('Launch')!;
      if (parts.has('Tease'))     expect(parts.get('Tease')!  < launch, `anchor ${start}`).toBe(true);
      if (parts.has('Follow-up')) expect(parts.get('Follow-up')! > launch, `anchor ${start}`).toBe(true);
    }
  });

  it('works on a 30-day month too — the end bound is not hardcoded to 31', () => {
    const sept = applyLaunchArc(
      { kind: 'launch', subject: 'X', sourceText: 't', dateRange: { start: '2026-09-30', end: '2026-09-30' } },
      roomyMonth().map((b) => ({ ...b, date: b.date.replace('2026-08', '2026-09') })),
      '2026-09',
    );
    const adds = sept.ops.filter((o): o is Extract<typeof o, { op: 'add' }> => o.op === 'add');
    expect(adds.map((a) => a.date)).toEqual(['2026-09-25', '2026-09-30']);
  });
});
