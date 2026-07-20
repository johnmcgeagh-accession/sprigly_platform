import { describe, it, expect } from 'vitest';
import {
  applyLaunchArc, applyEvent, applyEmphasis, applyBeatEdit, applyIntent,
  replacementCandidates, isReplaceable, resolveBeatRef, type TransformBeat,
} from './draft-transforms.js';
import type { MonthScopedIntent } from './intake-classify.js';
import type { BeatMeta } from '@sprigly/db';

const MONTH = '2026-09';
const TODAY = '2026-09-01';

const observed = (posts: number, avg = 40): BeatMeta => ({
  slotType: 'proven',
  rationaleEvidence: {
    basis: 'observed',
    formatEngagement: { format: 'carousel', avgEngagement: avg, posts },
    cadenceBasis: { postsPerWeek: 3, source: 'observed', months: 4 },
  },
});
const template = (): BeatMeta => ({
  slotType: 'proven',
  rationaleEvidence: { basis: 'template', reason: 'insufficient history' },
});
const clientTouched = (): BeatMeta => ({ ...observed(50), clientTouched: true });
const clientExperiment = (): BeatMeta => ({
  slotType: 'experiment',
  rationaleEvidence: { basis: 'observed', candidateRank: { rank: 1, of: 2, origin: 'client' } },
});

const beat = (id: string, date: string, meta: BeatMeta | null, over: Partial<TransformBeat> = {}): TransformBeat => ({
  id, date, format: 'carousel', pillar: 'Everyday Ritual', title: `Beat ${id}`, position: 0, beatMeta: meta, ...over,
});

const launch = (over: Partial<MonthScopedIntent> = {}): MonthScopedIntent => ({
  kind: 'launch', subject: 'the navy edit', sourceText: 'The navy edit drops on the 28th',
  dateRange: { start: '2026-09-28', end: '2026-09-28' }, ...over,
});

describe('the replacement rule — what may be evicted, and in what order', () => {
  it('protects a beat the CLIENT touched — their hand outranks the algorithm', () => {
    expect(isReplaceable(beat('a', '2026-09-05', clientTouched()))).toBe(false);
  });

  it('protects an experiment sourced from a client idea', () => {
    expect(isReplaceable(beat('a', '2026-09-05', clientExperiment()))).toBe(false);
  });

  it('protects a beat a previous client input created', () => {
    const fromInput: BeatMeta = { slotType: 'proven', rationaleEvidence: { basis: 'client_input', reason: 'x' } as BeatMeta['rationaleEvidence'] };
    expect(isReplaceable(beat('a', '2026-09-05', fromInput))).toBe(false);
    const manuallyAdded: BeatMeta = { slotType: 'proven', rationaleEvidence: { basis: 'client_added' } };
    expect(isReplaceable(beat('b', '2026-09-06', manuallyAdded))).toBe(false);
  });

  it('allows an ordinary observed beat', () => {
    expect(isReplaceable(beat('a', '2026-09-05', observed(20)))).toBe(true);
  });

  it('ranks TEMPLATE-basis beats first — no history justified them at all', () => {
    const pool = replacementCandidates([
      beat('strong', '2026-09-05', observed(30, 90)),
      beat('tmpl',   '2026-09-06', template()),
      beat('weak',   '2026-09-07', observed(3, 10)),
    ]);
    expect(pool[0]!.id).toBe('tmpl');
  });

  it('then ranks by smallest sample — the weakest claim goes first', () => {
    const pool = replacementCandidates([
      beat('n30', '2026-09-05', observed(30)),
      beat('n3',  '2026-09-06', observed(3)),
      beat('n12', '2026-09-07', observed(12)),
    ]);
    expect(pool.map((b) => b.id)).toEqual(['n3', 'n12', 'n30']);
  });

  it('is a TOTAL order — identical evidence still yields a stable, repeatable pick', () => {
    const beats = [beat('b', '2026-09-06', observed(10)), beat('a', '2026-09-05', observed(10))];
    expect(replacementCandidates(beats).map((b) => b.id))
      .toEqual(replacementCandidates([...beats].reverse()).map((b) => b.id));
  });
});

describe('applyLaunchArc', () => {
  const month = [
    beat('t1', '2026-09-02', template()),
    beat('t2', '2026-09-09', template()),
    beat('t3', '2026-09-16', template()),
    beat('s1', '2026-09-23', observed(30, 90)),
  ];

  it('places a three-part arc around the date and removes three beats — slot count is flat', () => {
    const { ops } = applyLaunchArc(launch(), month, MONTH);
    const adds = ops.filter((o) => o.op === 'add');
    const removes = ops.filter((o) => o.op === 'remove');
    expect(adds).toHaveLength(3);
    expect(removes).toHaveLength(3);
  });

  it('builds tease → launch → follow-up around the anchor', () => {
    const adds = applyLaunchArc(launch(), month, MONTH).ops.filter((o) => o.op === 'add') as Array<{ date: string; title: string; format: string }>;
    expect(adds.map((a) => a.date)).toEqual(['2026-09-23', '2026-09-28', '2026-09-30']);
    expect(adds.map((a) => a.title)).toEqual([
      'the navy edit — Tease', 'the navy edit — Launch', 'the navy edit — Follow-up',
    ]);
    expect(adds[1]!.format).toBe('reel');
  });

  it('clamps the arc INSIDE the plan month — a follow-up cannot spill into October', () => {
    const adds = applyLaunchArc(launch({ dateRange: { start: '2026-09-30', end: '2026-09-30' } }), month, MONTH)
      .ops.filter((o) => o.op === 'add') as Array<{ date: string }>;
    for (const a of adds) expect(a.date.startsWith('2026-09')).toBe(true);
  });

  it('evicts the WEAKEST beats, never the strong one', () => {
    const removed = applyLaunchArc(launch(), month, MONTH).ops
      .filter((o) => o.op === 'remove').map((o) => (o as { id: string }).id);
    expect(removed.sort()).toEqual(['t1', 't2', 't3']);
    expect(removed).not.toContain('s1');
  });

  it('gives every new beat HONEST evidence quoting the client', () => {
    const adds = applyLaunchArc(launch(), month, MONTH).ops.filter((o) => o.op === 'add') as Array<{ beatMeta: BeatMeta }>;
    for (const a of adds) {
      expect(a.beatMeta.rationaleEvidence.basis).toBe('client_input');
      expect(a.beatMeta.rationaleEvidence.reason).toBe('The navy edit drops on the 28th');
      expect(a.beatMeta.rationaleEvidence.formatEngagement).toBeUndefined();   // no metrics pretended
    }
  });

  it('places a PARTIAL arc and says so, rather than evicting protected beats', () => {
    const guarded = [beat('t1', '2026-09-02', template()), beat('c1', '2026-09-09', clientTouched())];
    const res = applyLaunchArc(launch(), guarded, MONTH);
    expect(res.ops.filter((o) => o.op === 'add')).toHaveLength(1);
    expect(res.note).toMatch(/Added 1 of 3/);
  });

  it('does nothing, loudly, when every beat is protected', () => {
    const res = applyLaunchArc(launch(), [beat('c1', '2026-09-09', clientTouched())], MONTH);
    expect(res.ops).toEqual([]);
    expect(res.note).toMatch(/added to your ideas instead/);
  });

  it('refuses without a date', () => {
    const res = applyLaunchArc(launch({ dateRange: null }), month, MONTH);
    expect(res.ops).toEqual([]);
    expect(res.note).toMatch(/No date/);
  });
});

describe('applyEvent', () => {
  const month = [beat('t1', '2026-09-02', template()), beat('s1', '2026-09-20', observed(40, 90))];
  const event: MonthScopedIntent = {
    kind: 'event', subject: 'market stall', sourceText: 'We have a market stall on the 12th',
    dateRange: { start: '2026-09-12', end: '2026-09-12' },
  };

  it('replaces one weak beat with a single dated beat', () => {
    const { ops } = applyEvent(event, month, MONTH);
    expect(ops).toHaveLength(2);
    expect(ops.find((o) => o.op === 'remove')).toMatchObject({ id: 't1' });
    expect(ops.find((o) => o.op === 'add')).toMatchObject({ date: '2026-09-12', title: 'market stall' });
  });

  it('never exceeds the slot count', () => {
    const { ops } = applyEvent(event, month, MONTH);
    const net = ops.filter((o) => o.op === 'add').length - ops.filter((o) => o.op === 'remove').length;
    expect(net).toBe(0);
  });
});

describe('applyEmphasis', () => {
  const month = [
    beat('past', '2026-08-20', observed(5)),                                    // before today
    beat('a', '2026-09-05', observed(5)),
    beat('b', '2026-09-08', observed(8)),
    beat('c', '2026-09-12', observed(12)),
    beat('touched', '2026-09-15', clientTouched()),
  ];
  const emphasis: MonthScopedIntent = {
    kind: 'emphasis', subject: 'more product', sourceText: 'more product this month', emphasis: 'Product & Fragrance',
  };

  it('never touches a PAST-dated beat', () => {
    const ids = applyEmphasis(emphasis, month, TODAY).ops.map((o) => (o as { id: string }).id);
    expect(ids).not.toContain('past');
  });

  it('never touches a CLIENT-EDITED beat', () => {
    const ids = applyEmphasis(emphasis, month, TODAY).ops.map((o) => (o as { id: string }).id);
    expect(ids).not.toContain('touched');
  });

  it('tilts the month rather than replacing it — at most a third of eligible beats', () => {
    const res = applyEmphasis(emphasis, month, TODAY);
    expect(res.ops.length).toBeLessThanOrEqual(1);        // 3 eligible → floor(3/3) = 1
    expect(res.ops.every((o) => o.op === 'update')).toBe(true);
  });

  it('converts the weakest-evidence beats first', () => {
    expect((applyEmphasis(emphasis, month, TODAY).ops[0] as { id: string }).id).toBe('a');   // n=5
  });

  it('recognises a FORMAT emphasis and changes format, not pillar', () => {
    const res = applyEmphasis({ ...emphasis, emphasis: 'reel' }, month, TODAY);
    expect(res.ops[0]).toMatchObject({ op: 'update', changes: { format: 'reel' } });
  });

  it('says so when there is nothing eligible left', () => {
    const res = applyEmphasis(emphasis, [beat('touched', '2026-09-15', clientTouched())], TODAY);
    expect(res.ops).toEqual([]);
    expect(res.note).toBeTruthy();
  });
});

describe('resolveBeatRef + applyBeatEdit', () => {
  const month = [
    beat('fri-reel', '2026-09-04', observed(10), { format: 'reel' }),      // a Friday
    beat('fri-car',  '2026-09-11', observed(10), { format: 'carousel' }),  // also a Friday
    beat('wed',      '2026-09-02', observed(10), { format: 'single' }),
  ];

  it('resolves "the Friday reel" to exactly one beat', () => {
    expect(resolveBeatRef('the friday reel', month).map((b) => b.id)).toEqual(['fri-reel']);
  });

  it('resolves a day-of-month reference', () => {
    expect(resolveBeatRef('the 2nd', month).map((b) => b.id)).toEqual(['wed']);
  });

  it('returns MULTIPLE matches for an ambiguous reference — the caller must not guess', () => {
    expect(resolveBeatRef('friday', month)).toHaveLength(2);
  });

  it('refuses an ambiguous reference rather than picking one', () => {
    const res = applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'friday', edit: 'drop' }, month, MONTH);
    expect(res.ops).toEqual([]);
    expect(res.note).toMatch(/could be 2 different posts/);
  });

  it('says so when the reference matches nothing', () => {
    const res = applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'the tuesday email', edit: 'drop' }, month, MONTH);
    expect(res.note).toMatch(/couldn’t find/);
  });

  it('drops, swaps format and moves an unambiguous reference', () => {
    expect(applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'the friday reel', edit: 'drop' }, month, MONTH).ops)
      .toEqual([{ op: 'remove', id: 'fri-reel' }]);
    expect(applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'the friday reel', edit: 'swap_format', editValue: 'carousel' }, month, MONTH).ops)
      .toEqual([{ op: 'update', id: 'fri-reel', changes: { format: 'carousel' } }]);
    expect(applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'the friday reel', edit: 'move', editValue: '2026-09-06' }, month, MONTH).ops)
      .toEqual([{ op: 'update', id: 'fri-reel', changes: { date: '2026-09-06' } }]);
  });

  it('rejects a format it cannot plan for', () => {
    const res = applyBeatEdit({ kind: 'beat_edit', subject: 'x', sourceText: 'x', beatRef: 'the friday reel', edit: 'swap_format', editValue: 'story' }, month, MONTH);
    expect(res.ops).toEqual([]);
  });
});

describe('applyIntent — determinism', () => {
  const month = [beat('t1', '2026-09-02', template()), beat('t2', '2026-09-09', template()), beat('t3', '2026-09-16', template())];

  it('same intent, same month → identical ops', () => {
    expect(applyIntent(launch(), month, MONTH, TODAY)).toEqual(applyIntent(launch(), month, MONTH, TODAY));
  });

  it('is independent of input row order', () => {
    const a = applyIntent(launch(), month, MONTH, TODAY);
    const b = applyIntent(launch(), [...month].reverse(), MONTH, TODAY);
    expect(a.ops).toEqual(b.ops);
  });
});
