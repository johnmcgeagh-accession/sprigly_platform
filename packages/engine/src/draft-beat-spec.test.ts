/**
 * draft-beat-spec.test.ts — typed calendar rows apply literally.
 *
 * The rehearsal showed operators typing ROWS, not requests: "Sat 22 Aug Reel What I am most
 * proud of… — part 2" bounced to the ideas backlog twice
 * (docs/reports/ivy-t-rehearsal-failures.md). A date-leading [date][format?][title] line is a
 * beat to place, not a sentence to interpret — so it short-circuits the model entirely and is
 * applied as one added beat: the given date, the named format (or the month's commonest), and
 * the title VERBATIM.
 *
 * Two entry points, one application path:
 *   parseBeatSpec  — the deterministic pre-parse (no model call)
 *   kind='beat_spec' via routeFromParsed — the model-side fallback for phrased near-misses
 * both dispatch through applyBeatSpec.
 */
import { describe, it, expect } from 'vitest';
import { parseBeatSpec, routeFromParsed } from './intake-classify.js';
import { applyBeatSpec, applyIntent, type TransformBeat } from './draft-transforms.js';
import type { MonthScopedIntent } from './intake-classify.js';
import type { BeatMeta } from '@sprigly/db';

const MONTH = '2026-08';
const TODAY = '2026-07-27';

const observed = (posts: number, format = 'carousel'): BeatMeta => ({
  slotType: 'proven',
  rationaleEvidence: { basis: 'observed', formatEngagement: { format, avgEngagement: 40, posts } },
});
const beat = (id: string, date: string, format = 'carousel'): TransformBeat =>
  ({ id, date, format, pillar: 'Simplify Your Morning', title: `Beat ${id}`, position: 0, beatMeta: observed(6, format) });

const roomyMonth = (): TransformBeat[] =>
  ['08-05', '08-08', '08-11', '08-16', '08-18'].map((d, i) => beat(`b${i}`, `2026-${d}`));

const addOps = (r: { ops: Array<{ op: string; date?: string; format?: string; title?: string; pillar?: string }> }) =>
  r.ops.filter((o) => o.op === 'add');

// ── The deterministic pre-parse ────────────────────────────────────────────────

describe('parseBeatSpec — the typed-row pre-parse', () => {
  it('matches the exact rehearsal sentence, format and title verbatim', () => {
    const spec = parseBeatSpec('Sat 22 Aug Reel What I am most proud of… — part 2', MONTH);
    expect(spec).not.toBeNull();
    expect(spec!.kind).toBe('beat_spec');
    expect(spec!.dateRange).toEqual({ start: '2026-08-22', end: '2026-08-22' });
    expect(spec!.format).toBe('reel');
    // VERBATIM — the em-dash ordinal is part of the client's title, not a clause to cut.
    expect(spec!.subject).toBe('What I am most proud of… — part 2');
  });

  it('matches a Friday carousel row with a hyphenated product title', () => {
    const spec = parseBeatSpec('Fri 14 Aug Carousel Weekend Style Guide — Lily tee & Sophie short co-ord', MONTH);
    expect(spec).not.toBeNull();
    expect(spec!.dateRange!.start).toBe('2026-08-14');
    expect(spec!.format).toBe('carousel');
    expect(spec!.subject).toBe('Weekend Style Guide — Lily tee & Sophie short co-ord');
  });

  it('matches a row with no weekday and no format', () => {
    const spec = parseBeatSpec('3 Aug Behind the seams at the Portugal factory', MONTH);
    expect(spec!.dateRange!.start).toBe('2026-08-03');
    expect(spec!.format).toBeUndefined();
    expect(spec!.subject).toBe('Behind the seams at the Portugal factory');
  });

  it('does NOT match a non-spec sentence', () => {
    expect(parseBeatSpec('we should do more reels', MONTH)).toBeNull();
  });

  it('does NOT match a date-leading REQUEST (has an intent verb)', () => {
    // "20 Aug move the reel to the 21st" is an instruction, not a row title.
    expect(parseBeatSpec('20 Aug move the reel to the 21st', MONTH)).toBeNull();
  });

  it('does NOT match a line with no real month', () => {
    expect(parseBeatSpec('22 people liked the last post', MONTH)).toBeNull();
  });

  it('does NOT match a multi-line paragraph', () => {
    expect(parseBeatSpec('14 Aug Carousel Weekend Style Guide\nand also add a reel', MONTH)).toBeNull();
  });

  it('takes the year from the plan month, never from the client', () => {
    expect(parseBeatSpec('9 Aug Restock drop', '2027-08')!.dateRange!.start).toBe('2027-08-09');
  });
});

// ── The transform ──────────────────────────────────────────────────────────────

describe('applyBeatSpec — literal placement', () => {
  it('adds exactly one beat, replacing nothing (slot count grows)', () => {
    const spec = parseBeatSpec('Sat 22 Aug Reel What I am most proud of… — part 2', MONTH)!;
    const before = roomyMonth();
    const res = applyBeatSpec(spec, before, MONTH);
    expect(res.ops.filter((o) => o.op === 'remove')).toHaveLength(0);
    const adds = addOps(res);
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({ date: '2026-08-22', format: 'reel', title: 'What I am most proud of… — part 2', pillar: '' });
  });

  it('stamps client_added + clientTouched — the client’s own hand, never auto-replaced', () => {
    const spec = parseBeatSpec('Sat 22 Aug Reel X', MONTH)!;
    const res = applyBeatSpec(spec, roomyMonth(), MONTH);
    const meta = (res.ops.find((o) => o.op === 'add') as { beatMeta: BeatMeta }).beatMeta;
    expect(meta.rationaleEvidence.basis).toBe('client_added');
    expect(meta.clientTouched).toBe(true);
  });

  it('keeps a long title WHOLE — the deriveTitle 60-char cap does not apply', () => {
    const long = 'A throwback post using the video of Sally fitting the pre-production long sleeve in Midnight Navy at the studio';
    const res = applyBeatSpec(parseBeatSpec(`14 Aug ${long}`, MONTH)!, roomyMonth(), MONTH);
    const title = (res.ops.find((o) => o.op === 'add') as { title: string }).title;
    expect(title).toBe(long);
    expect(title.length).toBeGreaterThan(60);
  });

  it('falls back to the month’s commonest format when none is named', () => {
    const before = [beat('a', '2026-08-05', 'carousel'), beat('b', '2026-08-08', 'carousel'), beat('c', '2026-08-11', 'reel')];
    const res = applyBeatSpec(parseBeatSpec('9 Aug Restock drop', MONTH)!, before, MONTH);
    expect((res.ops.find((o) => o.op === 'add') as { format: string }).format).toBe('carousel');
  });

  it('falls back to single on an empty month with no named format', () => {
    const res = applyBeatSpec(parseBeatSpec('9 Aug Restock drop', MONTH)!, [], MONTH);
    expect((res.ops.find((o) => o.op === 'add') as { format: string }).format).toBe('single');
  });
});

// ── The model-side fallback (phrased near-miss) ─────────────────────────────────

describe('kind=beat_spec — the model-side fallback', () => {
  const RAW = 'add a reel on the 22nd called What I am most proud of part 2';

  it('the pre-parse declines it (not date-leading), so the model owns it', () => {
    expect(parseBeatSpec(RAW, MONTH)).toBeNull();
  });

  it('a well-formed beat_spec intent routes month_scoped and applies as one added beat', () => {
    const parsed = {
      scope: 'month_scoped',
      intent: {
        kind: 'beat_spec', subject: 'What I am most proud of part 2', sourceText: RAW,
        dateRange: { start: '2026-08-22', end: '2026-08-22' }, format: 'reel',
      },
    };
    const routing = routeFromParsed(parsed, RAW);
    expect(routing.scope).toBe('month_scoped');
    const res = applyIntent((routing as { intent: MonthScopedIntent }).intent, roomyMonth(), MONTH, TODAY);
    const adds = addOps(res);
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({ date: '2026-08-22', format: 'reel', title: 'What I am most proud of part 2' });
  });

  it('a beat_spec with no date is filed, not dropped on a guessed day', () => {
    const parsed = { scope: 'month_scoped', intent: { kind: 'beat_spec', subject: 'A restock', sourceText: 'a restock' } };
    const routing = routeFromParsed(parsed, 'a restock');
    expect(routing.scope).toBe('evergreen');
    expect((routing as { reason: string }).reason).toBe('ambiguous');
  });
});
