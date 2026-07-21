/**
 * draft-title.test.ts — beat titles are derived, never echoed.
 *
 * The transforms used to write intent.subject verbatim. `subject` is bounded at 200 chars and
 * the classifier only ASKS for a short noun phrase, so on real briefing text the model
 * returned whole sentences. ivy-t's August plan carried six beats titled with raw briefing
 * prose, one clipped mid-date at the 200-char bound
 * (docs/reports/ivy-t-rehearsal-failures.md F1).
 *
 * The strings below are the ACTUAL stored titles from that plan.
 */
import { describe, it, expect } from 'vitest';
import { deriveTitle, applyEvent, applySeries, applyLaunchArc, type TransformBeat } from './draft-transforms.js';
import type { MonthScopedIntent } from './intake-classify.js';
import type { BeatMeta } from '@sprigly/db';

const MONTH = '2026-08';
const observed = (n: number): BeatMeta =>
  ({ slotType: 'proven', rationaleEvidence: { basis: 'observed', formatEngagement: { format: 'reel', avgEngagement: 40, posts: n } } });
const roomyMonth = (): TransformBeat[] =>
  ['08-05', '08-08', '08-11', '08-16', '08-18', '08-20', '08-23']
    .map((d, i) => ({ id: `b${i}`, date: `2026-${d}`, format: 'reel', pillar: 'P', title: `Beat ${i}`, position: 0, beatMeta: observed(i + 2) }));

describe('the REAL echoed titles from ivy-t’s plan', () => {
  it('the clipped-mid-date one becomes a readable label', () => {
    const t = deriveTitle('Weekend Style Guide every Friday in August: 7th — Maggie t-shirt grey marl; 14th');
    expect(t).toBe('Weekend Style Guide every Friday in August');
    expect(t.length).toBeLessThanOrEqual(61);
  });

  // These two lead with the date, as clients constantly do. Titling them "14th August" would
  // repeat the date column and say nothing, so the first SUBSTANTIVE clause wins instead.
  it('the factory-stock sentence skips the leading date', () => {
    expect(deriveTitle('14th August — the stock leaves the factory for our next drop. Tease it: can you guess what is coming?'))
      .toBe('the stock leaves the factory for our next drop');
  });

  it('the Portugal shutdown sentence skips the leading date', () => {
    expect(deriveTitle('15th August — our factory in Portugal starts its annual summer shutdown until 7th September'))
      .toBe('our factory in Portugal starts its annual summer shutdown…');
  });

  it('a bare date NEVER becomes the whole title', () => {
    for (const s of [
      '14th August — the stock leaves the factory for our next drop.',
      '2026-08-07: Maggie t-shirt grey marl in the golden hour light',
      '28th — Hannah t-shirt Navy, shot against the studio wall',
    ]) expect(deriveTitle(s)).not.toMatch(/^\d{1,2}(st|nd|rd|th)?(\s+\w+)?$/i);
  });

  it('the colour-reveal sentence', () => {
    const t = deriveTitle('In the Navy Edit build-up, include colour-reveal content — who can guess the main colour of the next Edit?');
    expect(t).toBe('In the Navy Edit build-up, include colour-reveal content');
    expect(t.length).toBeLessThanOrEqual(61);
  });

  it('the Sally throwback sentence', () => {
    expect(deriveTitle('A throwback post using the video of Sally fitting the pre-production long sleeve Ivy tee during the June heatwave'))
      .toBe('A throwback post using the video of Sally fitting the…');
  });

  it('every real echo comes out inside the cap', () => {
    const REAL = [
      'Weekend Style Guide every Friday in August: 7th — Maggie t-shirt grey marl; 14th',
      '14th August — the stock leaves the factory for our next drop. Tease it: can you guess what is coming?',
      '15th August — our factory in Portugal starts its annual summer shutdown until 7th September',
      'In the Navy Edit build-up, include colour-reveal content — who can guess the main colour of the next Edit?',
      'In the build-up, a post asking who can guess the new Hannah colour that people have asked for for years',
      'A throwback post using the video of Sally fitting the pre-production long sleeve Ivy tee during the June heatwave',
    ];
    for (const r of REAL) expect(deriveTitle(r).length, r).toBeLessThanOrEqual(61);
  });
});

describe('short subjects pass through untouched', () => {
  it.each([
    'The Navy Edit',
    'Maggie t-shirt grey marl',
    'Lily tee and Sophie short co-ord',
    'Emily sweatshirt in Midnight',
    'Hannah t-shirt Navy',
    'Weekend Style Guide',
  ])('%s', (s) => expect(deriveTitle(s)).toBe(s));

  it('a comma is NOT a clause break — one product with a comma survives whole', () => {
    expect(deriveTitle('Lily tee and Sophie short co-ord set, in navy'))
      .toBe('Lily tee and Sophie short co-ord set, in navy');
  });

  it('never returns an empty title', () => {
    expect(deriveTitle('')).toBe('Untitled beat');
    expect(deriveTitle('   ')).toBe('Untitled beat');
    expect(deriveTitle('...')).toBe('...');
  });

  it('a single enormous token is still capped', () => {
    expect(deriveTitle('x'.repeat(300)).length).toBeLessThanOrEqual(61);
  });
});

describe('the transforms use it', () => {
  const LONG = 'A throwback post using the video of Sally fitting the pre-production long sleeve Ivy tee during the June heatwave';

  it('applyEvent titles the beat with the derived form', () => {
    const r = applyEvent(
      { kind: 'event', subject: LONG, sourceText: LONG, dateRange: { start: '2026-08-10', end: '2026-08-10' } },
      roomyMonth(), MONTH,
    );
    const add = r.ops.find((o): o is Extract<typeof o, { op: 'add' }> => o.op === 'add')!;
    expect(add.title).toBe('A throwback post using the video of Sally fitting the…');
  });

  it('applyLaunchArc derives the stem but keeps its part labels', () => {
    const r = applyLaunchArc(
      { kind: 'launch', subject: LONG, sourceText: LONG, dateRange: { start: '2026-08-15', end: '2026-08-15' } },
      roomyMonth(), MONTH,
    );
    const titles = r.ops.filter((o): o is Extract<typeof o, { op: 'add' }> => o.op === 'add').map((o) => o.title);
    expect(titles).toEqual([
      'A throwback post using the video of Sally fitting the… — Tease',
      'A throwback post using the video of Sally fitting the… — Launch',
      'A throwback post using the video of Sally fitting the… — Follow-up',
    ]);
  });

  it('applySeries derives each instance subject', () => {
    const r = applySeries({
      kind: 'series', subject: 'Weekend Style Guide', sourceText: 'x',
      instances: [
        { date: '2026-08-07', subject: 'Maggie t-shirt grey marl. Shot on the beach at golden hour, styled loose.' },
        { date: '2026-08-14', subject: 'Lily tee and Sophie short co-ord' },
      ],
    }, roomyMonth(), MONTH);
    const titles = r.ops.filter((o): o is Extract<typeof o, { op: 'add' }> => o.op === 'add').map((o) => o.title);
    expect(titles).toEqual(['Maggie t-shirt grey marl', 'Lily tee and Sophie short co-ord']);
  });

  it('the ORDINAL fallback survives derivation — instances stay distinguishable', () => {
    const r = applySeries({
      kind: 'series', subject: "mini-series 'What I am most proud of…'", sourceText: 'x',
      recurrence: { startDate: '2026-08-01', intervalDays: 21 },
    }, roomyMonth(), MONTH);
    const titles = r.ops.filter((o): o is Extract<typeof o, { op: 'add' }> => o.op === 'add').map((o) => o.title);
    expect(titles).toEqual([
      "mini-series 'What I am most proud of…' — 1",
      "mini-series 'What I am most proud of…' — 2",
    ]);
    expect(new Set(titles).size).toBe(2);
  });

  it('the FULL text is still in the evidence — nothing is lost, only the label shortened', () => {
    const r = applyEvent(
      { kind: 'event', subject: LONG, sourceText: LONG, dateRange: { start: '2026-08-10', end: '2026-08-10' } },
      roomyMonth(), MONTH,
    );
    const add = r.ops.find((o): o is Extract<typeof o, { op: 'add' }> => o.op === 'add')!;
    expect((add.beatMeta.rationaleEvidence as { reason?: string }).reason).toBe(LONG);
  });
});
