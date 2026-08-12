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
import { applyCorrection, resolveBeatSubject, beatsOnNamedDate, applyIntent, type TransformBeat } from './draft-transforms.js';
import { diffBeats, renderDiff } from './draft-diff.js';
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

/**
 * A DATE MUST RESOLVE TO THE POST ON IT, whichever kind the classifier picked.
 *
 * Live, September: *"can we move the 22nd to the 25th?"* → *"We couldn't find 'the 22nd' on
 * this month's plan, so it was saved to your ideas instead"*, over a month holding a post on
 * the 22nd. `resolveBeatSubject` searches title + evidence reason and no date in any form, so
 * a bare ordinal could never match it; `resolveBeatRef` forty lines away has read dates since
 * it was written. CLASSIFY_SYSTEM steers "move …" to `correction`, so the client's most
 * ordinary reference landed in the one resolver blind to it.
 */
describe('beatsOnNamedDate — the correction path’s date reader', () => {
  const sept = (): TransformBeat[] => [
    beat({ id: 's22', date: '2026-09-22', title: 'Someone in your corner, always' }),
    beat({ id: 's25', date: '2026-09-25', title: 'Built on honest relationships' }),
    beat({ id: 's05', date: '2026-09-05', title: 'Top tips for the school run' }),
  ];

  it('resolves the bare ordinal the client actually types', () => {
    expect(beatsOnNamedDate('the 22nd', sept()).map((b) => b.id)).toEqual(['s22']);
  });

  it('accepts a named month, and CHECKS it against the beat’s own', () => {
    expect(beatsOnNamedDate('the 22nd of September', sept()).map((b) => b.id)).toEqual(['s22']);
    expect(beatsOnNamedDate('Sep 22', sept()).map((b) => b.id)).toEqual(['s22']);
    // A September plan must not answer for October's 22nd.
    expect(beatsOnNamedDate('the 22nd of October', sept())).toEqual([]);
  });

  it('accepts a full ISO date, matched whole', () => {
    expect(beatsOnNamedDate('2026-09-25', sept()).map((b) => b.id)).toEqual(['s25']);
    expect(beatsOnNamedDate('2026-10-25', sept())).toEqual([]);
  });

  /**
   * PINNED. Do not make the ordinal suffix optional to "also catch 'move 22 September'".
   *
   * `resolveBeatRef` can afford a bare number because `applyBeatEdit` refuses on zero or more
   * than one match. `applyCorrection` moves EVERY match, so the same looseness here turns a
   * phrase that named no date into a silent reschedule of an unrelated post. The unsuffixed
   * form failing is the price, and it is the right side to fail on.
   */
  it('never reads a bare number as a date', () => {
    expect(beatsOnNamedDate('the top 5 tips post', sept())).toEqual([]);
    expect(beatsOnNamedDate('22 September', sept())).toEqual([]);
    expect(beatsOnNamedDate('the launch', sept())).toEqual([]);
    expect(beatsOnNamedDate('', sept())).toEqual([]);
  });
});

describe('applyCorrection resolves a date when the subject cannot — and only then', () => {
  const sept = (): TransformBeat[] => [
    beat({ id: 's22', date: '2026-09-22', title: 'Someone in your corner, always' }),
    beat({ id: 's25', date: '2026-09-25', title: 'Built on honest relationships' }),
  ];

  it('“the 22nd” moves the post on the 22nd instead of filing it as an idea', () => {
    const res = applyCorrection(
      correction({ correctionOf: 'the 22nd', dateRange: { start: '2026-09-25', end: '2026-09-25' } }),
      sept(), '2026-09',
    );
    expect(res.ops).toEqual([{ op: 'update', id: 's22', changes: { date: '2026-09-25' } }]);
    // The count is stated even at one. It used to be silent here, which meant the only turns
    // that named a number were the plural ones — and a note that appears only sometimes is a
    // note the client learns to skim, on exactly the turn where the number matters most.
    expect(res.note).toBe('Moved 1 post from Tue 22 Sep — “Someone in your corner, always”.');
  });

  it('THE SUBJECT STILL WINS — a date is only ever the fallback', () => {
    // The Meadow sentence names its OLD date. Date-first would resolve on the 1st and move
    // whatever sits there; subject-first moves the arc, which is what this function is for.
    const beats = [...meadowArc(), beat({ id: 'z1', date: '2026-10-01', title: 'Unrelated' })];
    const res = applyCorrection(
      correction({ correctionOf: 'Meadow candle launch is the 1st', dateRange: { start: '2026-10-10', end: '2026-10-10' } }),
      beats, MONTH,
    );
    expect(res.ops.map((o) => 'id' in o && o.id)).toEqual(['m1', 'm2', 'm3']);
    expect(res.ops.some((o) => 'id' in o && o.id === 'z1')).toBe(false);
  });

  it('a date that holds two posts moves both, and the receipt names each one', () => {
    // September really does hold three doubled dates, so this is the case a client would
    // challenge. `renderDiff` writes one `Moved:` line per beat and the note says how many.
    const doubled = [
      beat({ id: 'd1', date: '2026-09-01', title: 'Stable Foundations' }),
      beat({ id: 'd2', date: '2026-09-01', title: 'Back to school', position: 1 }),
      beat({ id: 'k', date: '2026-09-09', title: 'Untouched' }),
    ];
    const res = applyCorrection(
      correction({ correctionOf: 'the 1st', dateRange: { start: '2026-09-25', end: '2026-09-25' } }),
      doubled, '2026-09',
    );
    expect(res.ops.map((o) => 'id' in o && o.id)).toEqual(['d1', 'd2']);
    // Names the DATE rather than echoing the client's phrase back at them. "the 1st" is what
    // they typed; "Tue 1 Sep" is the day they are looking at, and it matches the `Moved:` lines
    // directly above it because both now come from `shortDate`.
    expect(res.note).toBe('Moved all 2 posts on Tue 1 Sep, keeping the same spacing.');

    const lines = renderDiff(diffBeats(
      doubled.map((b) => ({ id: b.id, date: b.date, format: b.format, pillar: b.pillar, title: b.title })),
      doubled.map((b) => ({
        id: b.id, format: b.format, pillar: b.pillar, title: b.title,
        date: res.ops.find((o) => 'id' in o && o.id === b.id) ? '2026-09-25' : b.date,
      })),
    ));
    expect(lines).toContain('Moved: Stable Foundations, Tue 1 Sep → Fri 25 Sep');
    expect(lines).toContain('Moved: Back to school, Tue 1 Sep → Fri 25 Sep');
    expect(lines.filter((l) => l.startsWith('Moved:'))).toHaveLength(2);
  });

  it('a date with nothing on it is still filed, not invented', () => {
    const res = applyCorrection(
      correction({ correctionOf: 'the 14th', dateRange: { start: '2026-09-25', end: '2026-09-25' } }),
      sept(), '2026-09',
    );
    expect(res.ops).toEqual([]);
    expect(res.note).toMatch(/couldn’t find “the 14th”/);
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
