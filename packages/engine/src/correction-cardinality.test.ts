/**
 * correction-cardinality.test.ts — "a post" moves one; "the posts" moves them all.
 *
 * The defect, from cycle 5ea00045: "move a post from the 17th to the week before" moved all
 * three posts on the 17th, because `applyCorrection` mapped its ops over every match and read
 * no quantity at all. The follow-up — "I only wanted one of those moving" — then had nothing
 * to act on, so conversation memory landing (853c7eb) fixed the reading and not the doing.
 *
 * The boundary this file guards hardest is the one the code warns about in prose: cardinality
 * narrows the DATE-SCOPED fallback only. A named subject is an arc and moves whole.
 *
 * Pure — no model, no DB.
 */
import { describe, it, expect } from 'vitest';
import { applyCorrection, type TransformBeat, type TransformResult } from './draft-transforms.js';
import type { MonthScopedIntent } from './intake-classify.js';

const beat = (over: Partial<TransformBeat> & { id: string; date: string; title: string }): TransformBeat => ({
  format: 'single', pillar: 'Brand Story & Culture', position: 0, beatMeta: null, ...over,
});

/** The 17th of November, holding three — the shape the live cycle was in. */
const three = (): TransformBeat[] => [
  beat({ id: 'b1', date: '2026-11-17', title: 'Ethical, without cutting corners', position: 0 }),
  beat({ id: 'b2', date: '2026-11-17', title: 'Maybe pushing a product that is a jumper', position: 1 }),
  beat({ id: 'b3', date: '2026-11-17', title: 'giveaway post', position: 2 }),
  beat({ id: 'k', date: '2026-11-24', title: 'Untouched', position: 3 }),
];

/** `sourceText` is the client's VERBATIM sentence — what `requestedCount` reads. */
const say = (sourceText: string, over: Partial<MonthScopedIntent> = {}): MonthScopedIntent => ({
  kind: 'correction', subject: 'post on the 17th', correctionOf: 'post on the 17th',
  sourceText, dateRange: { start: '2026-11-10', end: '2026-11-10' }, ...over,
});

/** The beats an op set touches, in op order. `'id' in o` is the union's own narrowing — an
 *  `add` carries no id, and a correction never emits one. */
const movedIds = (r: TransformResult) => r.ops.map((o) => ('id' in o ? o.id : null));

describe('a singular ask moves one beat', () => {
  it('"move a post from the 17th to the week before" moves ONE, not three', () => {
    const r = applyCorrection(say('move a post from the 17th to the week before'), three(), '2026-11');
    expect(movedIds(r)).toEqual(['b1']);
  });

  it('takes the FIRST by position — the first one on the client’s own day view', () => {
    const shuffled = [
      beat({ id: 'b3', date: '2026-11-17', title: 'giveaway post', position: 2 }),
      beat({ id: 'b1', date: '2026-11-17', title: 'Ethical, without cutting corners', position: 0 }),
      beat({ id: 'b2', date: '2026-11-17', title: 'Maybe pushing a product', position: 1 }),
    ];
    const r = applyCorrection(say('move a post from the 17th to the 10th'), shuffled, '2026-11');
    expect(movedIds(r)).toEqual(['b1']);
  });

  it('the receipt names the count AND which one, and offers the rest', () => {
    const r = applyCorrection(say('move a post from the 17th to the 10th'), three(), '2026-11');
    expect(r.note).toBe(
      'Moved 1 of the 3 posts on Tue 17 Nov — “Ethical, without cutting corners”.'
      + ' Say “move all of them” if you meant the rest too.',
    );
  });

  it('"I only wanted one of those moving" is singular', () => {
    const r = applyCorrection(say('I only wanted one of those moving'), three(), '2026-11');
    expect(movedIds(r)).toEqual(['b1']);
  });
});

describe('a stated number moves that many', () => {
  it('"move 2 posts from the 10th to the 17th" moves TWO — it used to move all', () => {
    const onTenth = [
      beat({ id: 'a', date: '2026-11-10', title: 'One', position: 0 }),
      beat({ id: 'b', date: '2026-11-10', title: 'Two', position: 1 }),
      beat({ id: 'c', date: '2026-11-10', title: 'Three', position: 2 }),
    ];
    const r = applyCorrection(
      say('move 2 posts from the 10th to the 17th', {
        correctionOf: '2 posts on the 10th', dateRange: { start: '2026-11-17', end: '2026-11-17' },
      }), onTenth, '2026-11');
    expect(movedIds(r)).toEqual(['a', 'b']);
    expect(r.note).toBe('Moved 2 of the 3 posts on Tue 10 Nov — “One” and “Two”. Say “move all of them” if you meant the rest too.');
  });

  it('a count LARGER than the date holds moves what there is, and says so', () => {
    const two = [
      beat({ id: 'a', date: '2026-11-17', title: 'One', position: 0 }),
      beat({ id: 'b', date: '2026-11-17', title: 'Two', position: 1 }),
    ];
    const r = applyCorrection(say('move 5 posts from the 17th to the 10th'), two, '2026-11');
    expect(movedIds(r)).toEqual(['a', 'b']);
    expect(r.note).toBe('Moved all 2 posts on Tue 17 Nov, keeping the same spacing.');
  });
});

describe('a plural or unqualified ask moves everything — unchanged', () => {
  it('"move the posts from the 17th" moves all three', () => {
    const r = applyCorrection(say('move the posts from the 17th to the 10th'), three(), '2026-11');
    expect(movedIds(r)).toEqual(['b1', 'b2', 'b3']);
  });

  it('"move everything on the 17th" moves all three', () => {
    const r = applyCorrection(say('move everything on the 17th to the 10th'), three(), '2026-11');
    expect(movedIds(r)).toEqual(['b1', 'b2', 'b3']);
  });

  /**
   * The UNQUALIFIED case, and the operator's ruling on it: move all, state the count.
   * A phrasing that works today must not quietly start doing less.
   */
  it('"move the 17th to the 10th" names no quantity, so all three move', () => {
    const r = applyCorrection(say('move the 17th to the 10th'), three(), '2026-11');
    expect(movedIds(r)).toEqual(['b1', 'b2', 'b3']);
    expect(r.note).toBe('Moved all 3 posts on Tue 17 Nov, keeping the same spacing.');
  });

  it('a phrasing the parser does not handle falls through to all, never to a guess', () => {
    const r = applyCorrection(say('move a couple of posts from the 17th to the 10th'), three(), '2026-11');
    expect(movedIds(r)).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('a date holding exactly one beat is unchanged', () => {
  it('moves it, whatever the phrasing, and states the count at one', () => {
    const one = [beat({ id: 'solo', date: '2026-11-17', title: 'Only one', position: 0 })];
    for (const s of ['move a post from the 17th to the 10th', 'move the 17th to the 10th', 'move the posts from the 17th to the 10th']) {
      const r = applyCorrection(say(s), one, '2026-11');
      expect(movedIds(r)).toEqual(['solo']);
      expect(r.note).toBe('Moved 1 post from Tue 17 Nov — “Only one”.');
    }
  });
});

/**
 * ── THE NAMED-SUBJECT PATH IS UNTOUCHED ──────────────────────────────────────────────
 *
 * `draft-transforms.ts` records why `resolveBeatRef` and `beatsOnNamedDate` must not be
 * collapsed: the first identifies one post and its caller refuses ambiguity, the second may
 * return several and its caller moves them together. Cardinality narrows the SECOND only.
 * An arc is a shape, and taking one beat out of it is not a smaller version of the ask.
 */
describe('a named subject moves whole, singular phrasing or not', () => {
  const arc = (): TransformBeat[] => {
    const meta = { slotType: 'proven' as const, rationaleEvidence: { basis: 'client_input', reason: 'the Hannah launch' } as never };
    return [
      beat({ id: 'h1', date: '2026-11-01', title: 'Hannah launch — Tease', beatMeta: meta, position: 0 }),
      beat({ id: 'h2', date: '2026-11-03', title: 'Hannah launch — Launch', beatMeta: meta, position: 1 }),
      beat({ id: 'h3', date: '2026-11-06', title: 'Hannah launch — Follow-up', beatMeta: meta, position: 2 }),
    ];
  };

  it('"move the Hannah launch" moves all three beats of the arc', () => {
    const r = applyCorrection(
      say('move the Hannah launch to the 20th', {
        subject: 'Hannah launch', correctionOf: 'Hannah launch',
        dateRange: { start: '2026-11-20', end: '2026-11-20' },
      }), arc(), '2026-11');
    expect(movedIds(r)).toEqual(['h1', 'h2', 'h3']);
  });

  it('a SINGULAR sentence does not narrow an arc — cardinality never reaches this path', () => {
    const r = applyCorrection(
      say('move a post from the Hannah launch to the 20th', {
        subject: 'Hannah launch', correctionOf: 'Hannah launch',
        dateRange: { start: '2026-11-20', end: '2026-11-20' },
      }), arc(), '2026-11');
    expect(movedIds(r)).toEqual(['h1', 'h2', 'h3']);
    expect(r.note).toBe('Moved all 3 posts for “Hannah launch”, keeping the same spacing.');
  });

  it('keeps the arc’s relative spacing when it moves', () => {
    const r = applyCorrection(
      say('move the Hannah launch to the 20th', {
        subject: 'Hannah launch', correctionOf: 'Hannah launch',
        dateRange: { start: '2026-11-20', end: '2026-11-20' },
      }), arc(), '2026-11');
    expect(r.ops.map((o) => ('changes' in o ? o.changes.date : null)))
      .toEqual(['2026-11-20', '2026-11-22', '2026-11-25']);
  });

  it('the format guard still refuses an ambiguous match — untouched', () => {
    const r = applyCorrection(
      say('make the Hannah launch a reel', {
        subject: 'Hannah launch', correctionOf: 'Hannah launch', editValue: 'reel',
      }), arc(), '2026-11');
    expect(r.ops).toEqual([]);
    expect(r.unresolved).toBe(true);
  });
});

/**
 * A beat the client's own hand has been on is protected from DISPLACEMENT (replacementTier),
 * never from a move the client just asked for. Selection must not quietly acquire an opinion
 * about it either way.
 */
describe('clientTouched beats', () => {
  const touched = (): TransformBeat[] => [
    beat({ id: 't1', date: '2026-11-17', title: 'Client placed this', position: 0, beatMeta: { clientTouched: true } as never }),
    beat({ id: 't2', date: '2026-11-17', title: 'Machine placed this', position: 1 }),
  ];

  it('are moved when the client asks, and are not skipped over when picking one', () => {
    const r = applyCorrection(say('move a post from the 17th to the 10th'), touched(), '2026-11');
    expect(movedIds(r)).toEqual(['t1']);
  });

  it('are included when everything moves', () => {
    const r = applyCorrection(say('move the posts from the 17th to the 10th'), touched(), '2026-11');
    expect(movedIds(r)).toEqual(['t1', 't2']);
  });
});
