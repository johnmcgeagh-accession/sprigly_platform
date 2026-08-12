/**
 * correction-cardinality.test.ts — "a post" moves one; "the posts" moves them all.
 *
 * The defect, from cycle 5ea00045: "move a post from the 17th to the week before" moved all
 * three posts on the 17th, because `applyCorrection` mapped its ops over every match and read
 * no quantity at all. The follow-up — "I only wanted one of those moving" — then had nothing
 * to act on, so conversation memory landing (853c7eb) fixed the reading and not the doing.
 *
 * The boundary this file guards hardest: narrowing happens when the client STATED a number,
 * and only then. An unqualified ask moves everything on both paths — a date wholesale, an arc
 * whole — because a phrasing that works must not quietly start doing less. An explicit count
 * narrows either, because the client's own words outrank both the date they pointed at and
 * the title the classifier chose.
 *
 * Pure — no model, no DB.
 */
import { describe, it, expect } from 'vitest';
import { applyCorrection, namesNoSubject, type TransformBeat, type TransformResult } from './draft-transforms.js';
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
 * ── AN ARC MOVES WHOLE UNLESS THE CLIENT SAYS OTHERWISE ──────────────────────────────
 *
 * `draft-transforms.ts` records why `resolveBeatRef` and `beatsOnNamedDate` must not be
 * collapsed: the first identifies one post and its caller refuses ambiguity, the second may
 * return several and its caller moves them together. That protects an arc from a RESOLVER
 * quietly picking one of three, which is still true here — nothing narrows unless a number
 * was stated. What it does not cover is the client stating one, which is the case below.
 */
describe('a named subject moves whole unless a count says otherwise', () => {
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

  /**
   * REVERSED by operator ruling, and the reversal is the point.
   *
   * This used to assert that a singular sentence could not narrow an arc. It cost the client
   * six moved posts live (see the T2 block below), and the principle that settles it was
   * already in the file: the client's own words beat the model's restatement. `sourceText`
   * outranks `correctionOf`; by the same rule an explicit "a post" outranks a title match.
   */
  it('an EXPLICIT count narrows an arc — the client said how many they wanted', () => {
    const r = applyCorrection(
      say('move a post from the Hannah launch to the 20th', {
        subject: 'Hannah launch', correctionOf: 'Hannah launch',
        dateRange: { start: '2026-11-20', end: '2026-11-20' },
      }), arc(), '2026-11');
    expect(movedIds(r)).toEqual(['h1']);
    expect(r.note).toBe(
      'Moved 1 of the 3 posts matching “Hannah launch” — the one on Sun 1 Nov.'
      + ' Say “move all of them” if you meant the whole run.',
    );
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

/**
 * ── A QUANTITY PHRASE NAMES NO SUBJECT ───────────────────────────────────────────────
 *
 * `resolveBeatSubject` keeps words longer than three characters, so "2 posts on the 7th"
 * reduces to "posts" and matches any beat whose title or evidence contains that word. On
 * cycle 5ea00045 that was three unrelated beats, which took the named-subject branch and
 * moved all three — the client's "2" never reaching anything.
 */
describe('a phrase that is only a quantity and a date', () => {
  const evidenced = (id: string, date: string, title: string, position: number, reason: string): TransformBeat => ({
    id, date, title, position, format: 'single', pillar: 'Brand Story & Culture',
    beatMeta: { slotType: 'proven', rationaleEvidence: { basis: 'client_input', reason } } as never,
  });

  /** Three beats whose EVIDENCE mentions posts — the shape that caused the spurious match. */
  const connie = (): TransformBeat[] => [
    evidenced('c1', '2026-11-05', 'Connie', 0, 'client asked for three posts about Connie'),
    evidenced('c2', '2026-11-09', 'Connie', 1, 'client asked for three posts about Connie'),
    evidenced('c3', '2026-11-14', 'Connie', 2, 'client asked for three posts about Connie'),
    beat({ id: 'd1', date: '2026-11-07', title: 'First on the 7th', position: 3 }),
    beat({ id: 'd2', date: '2026-11-07', title: 'Second on the 7th', position: 4 }),
    beat({ id: 'd3', date: '2026-11-07', title: 'Third on the 7th', position: 5 }),
  ];

  it('resolves by DATE, not by the word "posts"', () => {
    const r = applyCorrection(
      say('move 2 posts from the 7th to the 6th', {
        subject: '2 posts on the 7th', correctionOf: '2 posts on the 7th',
        dateRange: { start: '2026-11-06', end: '2026-11-06' },
      }), connie(), '2026-11');
    // The three "Connie" beats are spread across three dates and are NOT what was asked for.
    expect(movedIds(r)).toEqual(['d1', 'd2']);
    expect(r.note).toContain('Moved 2 of the 3 posts on Sat 7 Nov');
  });

  it('a real subject still resolves by subject — it has words outside the quantity set', () => {
    expect(namesNoSubject('Meadow candle launch')).toBe(false);
    expect(namesNoSubject('Hannah launch')).toBe(false);
    expect(namesNoSubject('the top 5 tips post')).toBe(false);   // "tips" is a subject word
  });

  it('recognises the quantity-only phrases the classifier actually produces', () => {
    for (const s of ['2 posts on the 7th', 'post on the 17th', 'posts from the 17th',
                     'everything on the 17th', 'one of the posts on the 17th', 'both posts']) {
      expect(namesNoSubject(s)).toBe(true);
    }
  });

  it('an empty or date-only phrase is not "subjectless" — it has no significant words at all', () => {
    // These already fall through to the date resolver because resolveBeatSubject returns []
    // on an empty word list. The distinction is kept so the two reasons stay separable.
    expect(namesNoSubject('the 17th')).toBe(false);
    expect(namesNoSubject('')).toBe(false);
  });
});

/**
 * ── THE T2 REGRESSION ────────────────────────────────────────────────────────────────
 *
 * Live on cycle 5ea00045, with conversation memory in place:
 *
 *   T1  "move a post from the 12th to the 5th"   → one beat moved. Correct.
 *   T2  "I only wanted one of those moving"      → SIX beats of the Hannah arc moved a week.
 *
 * The chain: the thread let the classifier resolve "those", so `correctionOf` came back as
 * the previous turn's post TITLE; a title is a named subject; the named path moved every
 * match; and `resolveBeatSubject` matched all six Hannah beats because every significant
 * word of "Hannah in green — Launch" appears in each of them. Undoing one move cost six.
 */
describe('the T2 regression — a correction naming the previous turn’s post', () => {
  /** The Hannah arc as it stood at T2: two beats share the title the previous turn named. */
  const hannah = (): TransformBeat[] => {
    const m = (reason: string) => ({ slotType: 'proven' as const, rationaleEvidence: { basis: 'client_input', reason } as never });
    const src = 'launching Hannah in green';
    return [
      beat({ id: 'n1', date: '2026-11-05', title: 'Hannah in green — Launch',    beatMeta: m(src), position: 48 }),
      beat({ id: 'n2', date: '2026-11-07', title: 'Hannah in green — Tease',     beatMeta: m(src), position: 47 }),
      beat({ id: 'n3', date: '2026-11-15', title: 'Hannah in green — Follow-up', beatMeta: m(src), position: 49 }),
      beat({ id: 'n4', date: '2026-11-18', title: 'Hannah in green — Tease',     beatMeta: m(src), position: 41 }),
      beat({ id: 'n5', date: '2026-11-22', title: 'Hannah in green — Launch',    beatMeta: m(src), position: 42 }),
      beat({ id: 'n6', date: '2026-11-25', title: 'Hannah in green — Follow-up', beatMeta: m(src), position: 43 }),
    ];
  };

  const t2 = (over = {}) => say('I only wanted one of those moving', {
    subject: 'Hannah in green — Launch', correctionOf: 'Hannah in green — Launch',
    dateRange: { start: '2026-11-12', end: '2026-11-12' }, ...over,
  });

  it('moves ONE beat, not six', () => {
    expect(movedIds(applyCorrection(t2(), hannah(), '2026-11'))).toEqual(['n1']);
  });

  it('picks the beat the PREVIOUS TURN acted on — the exact title match, earliest', () => {
    // n1 and n5 both carry the title verbatim; n2/n3/n4/n6 matched on the words alone.
    // n1 is the one T1 moved, and it is the earlier of the two exact matches.
    const r = applyCorrection(t2(), hannah(), '2026-11');
    expect(movedIds(r)).toEqual(['n1']);
    expect(r.ops).toEqual([{ op: 'update', id: 'n1', changes: { date: '2026-11-12' } }]);
  });

  it('prefers an exact title match over an EARLIER substring match', () => {
    // The ranking must not collapse to "first by date", or a partial match sitting earlier
    // in the month would win over the beat whose title the previous turn actually quoted.
    const withEarlyNoise = [
      beat({ id: 'early', date: '2026-11-02', title: 'Hannah in green — Tease', position: 1 }),
      ...hannah(),
    ];
    expect(movedIds(applyCorrection(t2(), withEarlyNoise, '2026-11'))).toEqual(['n1']);
  });

  it('says it narrowed, how many matched, and which one it took', () => {
    expect(applyCorrection(t2(), hannah(), '2026-11').note).toBe(
      'Moved 1 of the 6 posts matching “Hannah in green — Launch” — the one on Thu 5 Nov.'
      + ' Say “move all of them” if you meant the whole run.',
    );
  });

  it('names DATES when narrowing a subject match, because the titles repeat', () => {
    const r = applyCorrection(t2({ sourceText: 'move 2 of those to the 12th' }), hannah(), '2026-11');
    expect(r.note).toBe(
      'Moved 2 of the 6 posts matching “Hannah in green — Launch” — Thu 5 Nov and Sun 22 Nov.'
      + ' Say “move all of them” if you meant the whole run.',
    );
  });

  it('an UNQUALIFIED correction on the same arc still moves all six, keeping spacing', () => {
    const r = applyCorrection(t2({ sourceText: 'move the Hannah launch to the 12th' }), hannah(), '2026-11');
    expect(movedIds(r)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
    expect(r.note).toBe('Moved all 6 posts for “Hannah in green — Launch”, keeping the same spacing.');
  });
});
