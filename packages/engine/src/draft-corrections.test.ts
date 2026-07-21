/**
 * draft-corrections.test.ts — a correction changes the month; a failed extraction says so.
 *
 * Both defects come from cycle 040d6a1a. A client wrote "Meadow candle launch is the 10th
 * not the 1st", twice. Both times the classifier's structured output failed its schema, the
 * routing fell back to evergreen, and the correction was filed as an "idea" with no signal
 * that the month had not changed (docs/reports/wrong-month-generated.md §6).
 *
 * Pure — no model, no DB. The transforms are deterministic by design, and routeFromParsed is
 * exported precisely so the fallback is testable without one.
 */
import { describe, it, expect, vi } from 'vitest';
import { applyCorrection, resolveBeatSubject, applyIntent, type TransformBeat } from './draft-transforms.js';
import { routeFromParsed, classifyIntake } from './intake-classify.js';
import type { MonthScopedIntent } from './intake-classify.js';

const MONTH = '2026-10';

const beat = (over: Partial<TransformBeat> & { id: string; date: string; title: string }): TransformBeat => ({
  format: 'single', pillar: 'Brand Story & Culture', position: 0, beatMeta: null, ...over,
});

/** A three-beat Meadow arc as applyLaunchArc writes it: title + evidence carry the words. */
const meadowArc = (): TransformBeat[] => {
  const meta = (reason: string) => ({
    slotType: 'proven' as const,
    rationaleEvidence: { basis: 'client_input', reason } as never,
  });
  const src = "We're also relaunching the Meadow candle on the 1st";
  return [
    beat({ id: 'm1', date: '2026-10-01', title: 'Meadow candle relaunch — Tease',     beatMeta: meta(src), position: 14 }),
    beat({ id: 'm2', date: '2026-10-03', title: 'Meadow candle relaunch — Launch',    beatMeta: meta(src), position: 15 }),
    beat({ id: 'm3', date: '2026-10-06', title: 'Meadow candle relaunch — Follow-up', beatMeta: meta(src), position: 16 }),
  ];
};

const other = () => [
  beat({ id: 'w1', date: '2026-10-26', title: 'wilderness candle launch — Tease' }),
  beat({ id: 'x1', date: '2026-10-16', title: 'Everyday Ritual' }),
  beat({ id: 'k1', date: '2026-10-15', title: 'An afternoon spent making something', pillar: 'Workshops & Experiences' }),
];

const correction = (over: Partial<MonthScopedIntent>): MonthScopedIntent => ({
  kind: 'correction', subject: 'Meadow candle launch', sourceText: 'x', ...over,
} as MonthScopedIntent);

describe('resolveBeatSubject — matches the thing, not merely a word of it', () => {
  it('finds every beat of the named arc', () => {
    const beats = [...meadowArc(), ...other()];
    expect(resolveBeatSubject('Meadow candle launch', beats).map((b) => b.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('does NOT match a different candle just because both say "candle"', () => {
    const beats = [...meadowArc(), ...other()];
    expect(resolveBeatSubject('wilderness candle', beats).map((b) => b.id)).toEqual(['w1']);
  });

  it('matches on the evidence reason when the title was phrased by the assembler', () => {
    const beats = [beat({
      id: 'p1', date: '2026-10-02', title: 'Product & Fragrance',
      beatMeta: { slotType: 'proven', rationaleEvidence: { basis: 'client_input', reason: 'the ceramics restock' } } as never,
    })];
    expect(resolveBeatSubject('ceramics restock', beats).map((b) => b.id)).toEqual(['p1']);
  });

  it('refuses to guess from a short or empty subject', () => {
    expect(resolveBeatSubject('the', meadowArc())).toEqual([]);
    expect(resolveBeatSubject('', meadowArc())).toEqual([]);
  });
});

describe('applyCorrection — the Meadow sentence, and its siblings', () => {
  it('THE UAT SENTENCE: moves the whole arc, keeping relative spacing', () => {
    const beats = [...meadowArc(), ...other()];
    const res = applyCorrection(correction({
      correctionOf: 'Meadow candle launch',
      sourceText: 'Meadow candle launch is the 10th not the 1st',
      dateRange: { start: '2026-10-10', end: '2026-10-10' },
    }), beats, MONTH);

    // Original offsets from the anchor were +0, +2, +5 days. They survive the move.
    expect(res.ops).toEqual([
      { op: 'update', id: 'm1', changes: { date: '2026-10-10' } },
      { op: 'update', id: 'm2', changes: { date: '2026-10-12' } },
      { op: 'update', id: 'm3', changes: { date: '2026-10-15' } },
    ]);
    expect(res.note).toContain('keeping the same spacing');
    // And nothing else on the month is touched.
    expect(res.ops.every((o) => ['m1', 'm2', 'm3'].includes((o as { id: string }).id))).toBe(true);
  });

  it('"actually the workshop is the 15th" moves the single matched beat', () => {
    const beats = [...meadowArc(), ...other()];
    const res = applyCorrection(correction({
      correctionOf: 'afternoon spent making something',
      subject: 'the workshop',
      sourceText: 'actually the workshop is the 15th',
      dateRange: { start: '2026-10-15', end: '2026-10-15' },
    }), beats, MONTH);

    expect(res.ops).toEqual([{ op: 'update', id: 'k1', changes: { date: '2026-10-15' } }]);
    expect(res.note).toBeUndefined();          // one beat: no "kept the spacing" claim
  });

  it('"make the launch post a reel" changes format, not date', () => {
    const beats = [beat({ id: 'w1', date: '2026-10-26', title: 'wilderness candle launch — Launch' })];
    const res = applyCorrection(correction({
      correctionOf: 'wilderness candle launch',
      sourceText: 'make the launch post a reel',
      edit: 'swap_format', editValue: 'reel',
    }), beats, MONTH);

    expect(res.ops).toEqual([{ op: 'update', id: 'w1', changes: { format: 'reel' } }]);
  });

  it('a format correction matching several posts refuses rather than guessing', () => {
    const res = applyCorrection(correction({
      correctionOf: 'Meadow candle', sourceText: 'make the meadow post a reel',
      edit: 'swap_format', editValue: 'reel',
    }), meadowArc(), MONTH);

    expect(res.ops).toEqual([]);
    expect(res.note).toContain('3 posts');
  });

  it('a correction naming nothing on the plan produces no ops → the caller files it evergreen', () => {
    const res = applyCorrection(correction({
      correctionOf: 'the Christmas hamper launch',
      sourceText: 'the hamper launch is the 12th not the 5th',
      dateRange: { start: '2026-10-12', end: '2026-10-12' },
    }), [...meadowArc(), ...other()], MONTH);

    expect(res.ops).toEqual([]);
    expect(res.note).toContain('couldn’t find');
  });

  it('a correction with no new date and no format change is filed, not guessed at', () => {
    const res = applyCorrection(correction({ correctionOf: 'Meadow candle launch' }), meadowArc(), MONTH);
    expect(res.ops).toEqual([]);
    expect(res.note).toContain('wasn’t clear');
  });

  it('a move that would fall outside the month is clamped into it', () => {
    const res = applyCorrection(correction({
      correctionOf: 'Meadow candle launch',
      dateRange: { start: '2026-10-30', end: '2026-10-30' },
    }), meadowArc(), MONTH);

    for (const op of res.ops) {
      expect((op as { changes: { date: string } }).changes.date.startsWith('2026-10')).toBe(true);
    }
  });

  it('applyIntent dispatches kind=correction here', () => {
    const res = applyIntent(correction({
      correctionOf: 'Meadow candle launch',
      dateRange: { start: '2026-10-10', end: '2026-10-10' },
    }), meadowArc(), MONTH, '2026-09-01');
    expect(res.ops).toHaveLength(3);
  });
});

describe('routeFromParsed — a correction survives validation', () => {
  it('accepts a well-formed correction', () => {
    const r = routeFromParsed({
      scope: 'month_scoped',
      intent: {
        kind: 'correction', subject: 'Meadow candle launch',
        sourceText: 'Meadow candle launch is the 10th not the 1st',
        correctionOf: 'Meadow candle launch',
        dateRange: { start: '2026-10-10', end: '2026-10-10' },
      },
    }, 'Meadow candle launch is the 10th not the 1st');
    expect(r.scope).toBe('month_scoped');
  });

  it('a correction naming nothing to correct is ambiguous, not applied', () => {
    const r = routeFromParsed({
      scope: 'month_scoped',
      intent: { kind: 'correction', subject: '', sourceText: 'fix it', correctionOf: null },
    }, 'fix it');
    expect(r).toMatchObject({ scope: 'evergreen' });
  });
});

describe('classifyIntake — retry once, then say so', () => {
  const base = { text: 'Meadow candle launch is the 10th not the 1st', planMonth: '2026-10' };
  const junk = { content: 'not json at all', modelId: 'm', inputTokens: 1, outputTokens: 1 };
  const good = {
    content: JSON.stringify({
      scope: 'month_scoped',
      intent: {
        kind: 'correction', subject: 'Meadow candle launch', sourceText: base.text,
        correctionOf: 'Meadow candle launch', dateRange: { start: '2026-10-10', end: '2026-10-10' },
      },
    }),
    modelId: 'm', inputTokens: 1, outputTokens: 1,
  };

  it('failure then SUCCESS applies normally — one bad sample does not cost the month', async () => {
    const complete = vi.fn().mockResolvedValueOnce(junk).mockResolvedValueOnce(good);
    const r = await classifyIntake({ ...base, model: { complete } as never });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(r.scope).toBe('month_scoped');
  });

  it('failure TWICE files it as couldnt_apply — never the silent demotion', async () => {
    const complete = vi.fn().mockResolvedValue(junk);
    const r = await classifyIntake({ ...base, model: { complete } as never });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ scope: 'evergreen', reason: 'couldnt_apply' });
  });

  it('a confident evergreen is an ANSWER — not retried', async () => {
    const complete = vi.fn().mockResolvedValue({
      content: JSON.stringify({ scope: 'evergreen' }), modelId: 'm', inputTokens: 1, outputTokens: 1,
    });
    const r = await classifyIntake({ ...base, model: { complete } as never });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ scope: 'evergreen', reason: 'classified_evergreen' });
  });
});
