/**
 * draft-series.test.ts — the series intent kind, against ivy-t's REAL rehearsal inputs.
 *
 * Every fixture below is verbatim from the 2026-07-21 rehearsal brief, and each one produced
 * a wrong month before this transform existed (docs/reports/ivy-t-rehearsal-failures.md):
 *   - the Weekend Style Guide became ONE beat on 1 Aug, then a second launch arc
 *   - the mini-series became a tease/launch/follow-up compressed into 1–4 Aug
 * The Navy Edit input is here as the regression guard: it IS a launch, and must stay one.
 *
 * These assert the TRANSFORM given a correctly-classified intent. Whether the live model
 * returns kind='series' for this text is a prompt question and cannot be pinned without a
 * model call — see the report's "live-classifier check" note.
 */
import { describe, it, expect } from 'vitest';
import { applySeries, applyIntent, expandSeries, type TransformBeat } from './draft-transforms.js';
import { routeFromParsed } from './intake-classify.js';
import type { MonthScopedIntent } from './intake-classify.js';
import type { BeatMeta } from '@sprigly/db';

const MONTH = '2026-08';
const TODAY = '2026-07-21';

const observed = (posts: number, avg = 40): BeatMeta => ({
  slotType: 'proven',
  rationaleEvidence: { basis: 'observed', formatEngagement: { format: 'reel', avgEngagement: avg, posts } },
});
const beat = (id: string, date: string, meta: BeatMeta | null = observed(6)): TransformBeat =>
  ({ id, date, format: 'reel', pillar: 'Simplify Your Morning', title: `Beat ${id}`, position: 0, beatMeta: meta });

/** A month with plenty of replaceable beats — the pool is not what these tests are about. */
const roomyMonth = (): TransformBeat[] =>
  ['08-05', '08-08', '08-11', '08-16', '08-18', '08-20', '08-23', '08-26', '08-29']
    .map((d, i) => beat(`b${i}`, `2026-${d}`, observed(i + 2)));

const addsOn = (r: { ops: Array<{ op: string; date?: string; title?: string }> }) =>
  r.ops.filter((o) => o.op === 'add').map((o) => ({ date: o.date, title: o.title }));

// ── FIXTURE 1 — the Weekend Style Guide, enumerated ───────────────────────────

const STYLE_GUIDE_TEXT =
  'Weekend Style Guide every Friday in August: 7th — Maggie t-shirt grey marl; 14th — Lily tee and Sophie short co-ord; 21st — Emily sweatshirt in Midnight; 28th — Hannah t-shirt Navy.';

const styleGuideIntent = (): MonthScopedIntent => ({
  kind: 'series', subject: 'Weekend Style Guide', sourceText: STYLE_GUIDE_TEXT,
  instances: [
    { date: '2026-08-07', subject: 'Maggie t-shirt grey marl' },
    { date: '2026-08-14', subject: 'Lily tee and Sophie short co-ord' },
    { date: '2026-08-21', subject: 'Emily sweatshirt in Midnight' },
    { date: '2026-08-28', subject: 'Hannah t-shirt Navy' },
  ],
});

describe('FIXTURE — Weekend Style Guide (enumerated, 4 Fridays)', () => {
  it('places FOUR beats on the four Fridays the client listed', () => {
    const adds = addsOn(applySeries(styleGuideIntent(), roomyMonth(), MONTH));
    expect(adds.map((a) => a.date)).toEqual(['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']);
  });

  it('gives each Friday ITS OWN product as the subject — not four identical beats', () => {
    const adds = addsOn(applySeries(styleGuideIntent(), roomyMonth(), MONTH));
    expect(adds.map((a) => a.title)).toEqual([
      'Maggie t-shirt grey marl',
      'Lily tee and Sophie short co-ord',
      'Emily sweatshirt in Midnight',
      'Hannah t-shirt Navy',
    ]);
  });

  it('places NO arc — no tease, no launch, no follow-up', () => {
    const titles = addsOn(applySeries(styleGuideIntent(), roomyMonth(), MONTH)).map((a) => a.title ?? '');
    for (const t of titles) expect(t).not.toMatch(/tease|launch|follow-up/i);
  });

  it('replaces exactly one beat per instance — the slot count never grows', () => {
    const before = roomyMonth();
    const r = applySeries(styleGuideIntent(), before, MONTH);
    expect(r.ops.filter((o) => o.op === 'remove')).toHaveLength(4);
    expect(r.ops.filter((o) => o.op === 'add')).toHaveLength(4);
  });

  it('the 4 September instance is DEFERRED, not placed and not lost', () => {
    const withSept = styleGuideIntent();
    withSept.instances = [...(withSept.instances ?? []), { date: '2026-09-04', subject: 'Long sleeve Orla t-shirt' }];
    const r = applySeries(withSept, roomyMonth(), MONTH);
    expect(addsOn(r).map((a) => a.date)).toEqual(['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']);
    expect(r.deferred).toEqual([{ date: '2026-09-04', subject: 'Long sleeve Orla t-shirt' }]);
    expect(r.note).toContain('saved to your ideas');
  });
});

// ── FIXTURE 2 — the mini-series, interval ─────────────────────────────────────

const MINI_TEXT =
  "New mini-series starting early August, one post every 3 weeks, hook 'What I am most proud of…' — each one sharing a specific aspect of the brand, fabrics, team, or Sally's own story.";

const miniIntent = (): MonthScopedIntent => ({
  kind: 'series', subject: "mini-series 'What I am most proud of…'", sourceText: MINI_TEXT,
  recurrence: { startDate: '2026-08-01', intervalDays: 21 },
});

describe("FIXTURE — mini-series 'What I am most proud of…' (every 3 weeks)", () => {
  it('places TWO beats in August, three weeks apart — 1st and 22nd', () => {
    const adds = addsOn(applySeries(miniIntent(), roomyMonth(), MONTH));
    expect(adds.map((a) => a.date)).toEqual(['2026-08-01', '2026-08-22']);
  });

  it('places NO arc — this is the exact input that produced tease+launch on 1 Aug', () => {
    const adds = addsOn(applySeries(miniIntent(), roomyMonth(), MONTH));
    expect(adds.map((a) => a.title)).toEqual([
      "mini-series 'What I am most proud of…' — 1",
      "mini-series 'What I am most proud of…' — 2",
    ]);
    expect(adds.map((a) => a.date)).not.toContain('2026-08-04');   // the old follow-up slot
  });

  it('replaces two beats, not three — one per instance', () => {
    const r = applySeries(miniIntent(), roomyMonth(), MONTH);
    expect(r.ops.filter((o) => o.op === 'remove')).toHaveLength(2);
  });

  it('stops at the month end rather than running on forever', () => {
    expect(expandSeries(miniIntent(), MONTH).map((i) => i.date)).toEqual(['2026-08-01', '2026-08-22']);
  });

  it('honours an explicit count bound', () => {
    const capped = miniIntent();
    capped.recurrence = { startDate: '2026-08-01', intervalDays: 7, count: 2 };
    expect(expandSeries(capped, MONTH).map((i) => i.date)).toEqual(['2026-08-01', '2026-08-08']);
  });

  it('honours an `until` earlier than the month end', () => {
    const capped = miniIntent();
    capped.recurrence = { startDate: '2026-08-01', intervalDays: 7, until: '2026-08-15' };
    expect(expandSeries(capped, MONTH).map((i) => i.date)).toEqual(['2026-08-01', '2026-08-08', '2026-08-15']);
  });
});

// ── FIXTURE 3 — the Navy Edit must STILL be a launch ──────────────────────────

describe('FIXTURE — the Navy Edit launch (regression: still an arc)', () => {
  const navy = (): MonthScopedIntent => ({
    kind: 'launch', subject: 'The Navy Edit', sourceText: 'The Navy Edit launches on 28th August at 7pm.',
    dateRange: { start: '2026-08-28', end: '2026-08-28' },
  });

  it('still produces a three-part arc, not a series', () => {
    const adds = addsOn(applyIntent(navy(), roomyMonth(), MONTH, TODAY));
    expect(adds).toHaveLength(3);
    expect(adds.map((a) => a.title)).toEqual([
      'The Navy Edit — Tease', 'The Navy Edit — Launch', 'The Navy Edit — Follow-up',
    ]);
    expect(adds.map((a) => a.date)).toEqual(['2026-08-23', '2026-08-28', '2026-08-31']);
  });
});

// ── Dispatch + contract ───────────────────────────────────────────────────────

describe('series dispatch and contract', () => {
  it('applyIntent routes kind=series to applySeries', () => {
    const viaDispatch = applyIntent(styleGuideIntent(), roomyMonth(), MONTH, TODAY);
    expect(addsOn(viaDispatch).map((a) => a.date))
      .toEqual(['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']);
  });

  it('ENUMERATED dates beat a recurrence rule when the model returns both', () => {
    const both = styleGuideIntent();
    both.recurrence = { startDate: '2026-08-01', intervalDays: 3 };
    expect(expandSeries(both, MONTH).map((i) => i.date))
      .toEqual(['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28']);
  });

  it('a series with NEITHER a list nor a rule is filed, never invented', () => {
    const routed = routeFromParsed(
      { scope: 'month_scoped', intent: { kind: 'series', subject: 'a mini-series', sourceText: 'x' } },
      'we should do a mini-series sometime',
    );
    expect(routed).toEqual({ scope: 'evergreen', sourceText: 'we should do a mini-series sometime', reason: 'ambiguous' });
  });

  it('a series validates and routes month_scoped when it HAS instances', () => {
    const routed = routeFromParsed(
      { scope: 'month_scoped', intent: { kind: 'series', subject: 'Style Guide', sourceText: 'x', instances: [{ date: '2026-08-07' }] } },
      STYLE_GUIDE_TEXT,
    );
    expect(routed.scope).toBe('month_scoped');
  });

  it('every instance out of month → nothing placed, everything deferred', () => {
    const sept = styleGuideIntent();
    sept.instances = [{ date: '2026-09-04', subject: 'Orla' }, { date: '2026-09-11', subject: 'Ivy' }];
    const r = applySeries(sept, roomyMonth(), MONTH);
    expect(r.ops).toEqual([]);
    expect(r.deferred).toHaveLength(2);
  });
});
