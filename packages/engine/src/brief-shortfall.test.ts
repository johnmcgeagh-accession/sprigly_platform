/**
 * brief-shortfall.test.ts — the drop, caught.
 *
 * The fixture is ivy-t's LIVE November brief, cycle 5ea00045: the accumulated freeNotes as the
 * client typed them, and the structured_brief the extractor actually persisted from them. That
 * pairing is the whole point — the brief below is complete, gate-passing and wrong, and the
 * only thing separating it from a correct extraction is three products nobody counted.
 */
import { describe, it, expect } from 'vitest';
import { briefProductShortfall, NO_SHORTFALL } from './brief-shortfall.js';

/** ivy-t's catalogue family names, as stored in client_product_catalogue. */
const CATALOGUE = [
  'Anna', 'Arabella', 'Audrey', 'Bea', 'Claire', 'Connie', 'Dotty', 'Elle', 'Emily', 'Emma',
  'Erin', 'Fiona', 'Hannah', 'Heather', 'Iris', 'Ivy', 'Jane', 'Jen', 'Joy', 'Jules', 'Kate',
  'Layla', 'Lily', 'Lydia', 'Mabel', 'Maggie', 'Marley', 'Maya', 'Megan', 'Nancy', 'Nicola',
  'Nora', 'Orla', 'Rose', 'Sadie', 'Sally', 'Sam', 'Sonny', 'Sophie', 'Thia', 'Verity', 'Willow',
];

/** The accumulated freeNotes, verbatim — the tail is where the products go missing. */
const LIVE_NOTES = [
  'Move the Maya post on the 5th to the 12th instead.',
  'Big Connie relaunch on the 24th of November. Build up to it with posts on the 21st, 22nd and 23rd, all about Connie.',
  "On the 12th we're going to launch Hannah in green, can you write a teaser the week before and a follow up the week after as well as the launch post? Make them all reels.",
  'push Hannah in green launch out to the 18th',
  "On the 12th we're going to launch Maggie in yellow, can you write a teaser the week before",
].join('\n\n');

/** What the extractor persisted: Hannah, Connie and Maya survived. Maggie did not. */
const DROPPED_BRIEF = {
  products: [
    { product: 'Hannah', colourway: 'green', status: 'new',     launch_date: '2026-11-12' },
    { product: 'Connie', colourway: null,    status: 'restock', launch_date: '2026-11-24' },
  ],
  schedule: [
    { date: '2026-11-12', type: 'launch',    product: 'Hannah', colourway: 'green', dateRange: null },
    { date: '2026-11-12', type: 'note',      product: 'Maya',   colourway: null,    dateRange: null },
    { date: '2026-11-24', type: 'launch',    product: 'Connie', colourway: null,    dateRange: null },
    { date: null, type: 'teaser', product: 'Hannah', colourway: 'green', dateRange: { start: '2026-11-05', end: '2026-11-11' } },
  ],
  content_asks: [],
  focus: ['Hannah', 'Connie'],
  conflicts: [],
  plan_window: { from: null, month: '2026-11' },
};

describe('the live drop', () => {
  it('names Maggie as missing from the brief that dropped her', () => {
    const shortfall = briefProductShortfall(LIVE_NOTES, DROPPED_BRIEF, CATALOGUE);
    expect(shortfall.missing).toEqual(['Maggie']);
  });

  it('counts every catalogue product the notes actually name', () => {
    const shortfall = briefProductShortfall(LIVE_NOTES, DROPPED_BRIEF, CATALOGUE);
    expect(shortfall.named.sort()).toEqual(['Connie', 'Hannah', 'Maggie', 'Maya']);
  });

  it('reports nothing once the same brief carries Maggie', () => {
    const complete = {
      ...DROPPED_BRIEF,
      schedule: [...DROPPED_BRIEF.schedule,
        { date: '2026-11-12', type: 'launch', product: 'Maggie', colourway: 'yellow', dateRange: null }],
    };
    expect(briefProductShortfall(LIVE_NOTES, complete, CATALOGUE).missing).toEqual([]);
  });

  /** A name reaching ANY array means the extractor saw the product — see the module note. */
  it('does not report a product the extractor filed as an undated ask', () => {
    const asAsk = {
      ...DROPPED_BRIEF,
      content_asks: [{ type: 'teaser', product: 'Maggie', note: 'Maggie in yellow' }],
    };
    expect(briefProductShortfall(LIVE_NOTES, asAsk, CATALOGUE).missing).toEqual([]);
  });
});

describe('the ordinary-English catalogue', () => {
  /**
   * Half this catalogue is a common noun worn as a first name. Case-insensitive matching reads
   * the sentence below as a Joy launch and then reports it missing.
   */
  it('reads lower-case "joy" as the word, not the garment', () => {
    const notes = 'Something to spread joy this Christmas, and a rose gold palette post.';
    expect(briefProductShortfall(notes, DROPPED_BRIEF, CATALOGUE)).toEqual(NO_SHORTFALL);
  });

  it('still catches the capitalised product in the same sentence', () => {
    const notes = 'Spread joy this Christmas — and launch Joy on the 9th.';
    expect(briefProductShortfall(notes, { schedule: [] }, CATALOGUE).missing).toEqual(['Joy']);
  });

  it('matches a possessive and a trailing comma, but not a longer word', () => {
    expect(briefProductShortfall("Maggie's launch", { schedule: [] }, CATALOGUE).missing).toEqual(['Maggie']);
    expect(briefProductShortfall('Maggie, on the 9th', { schedule: [] }, CATALOGUE).missing).toEqual(['Maggie']);
    expect(briefProductShortfall('Maggies are selling', { schedule: [] }, CATALOGUE).missing).toEqual([]);
  });
});

describe('degrades quietly, because it runs after the save', () => {
  it('says nothing on empty notes, a null brief, or an empty catalogue', () => {
    expect(briefProductShortfall('', DROPPED_BRIEF, CATALOGUE)).toEqual(NO_SHORTFALL);
    expect(briefProductShortfall(LIVE_NOTES, null, CATALOGUE)).toEqual(NO_SHORTFALL);
    expect(briefProductShortfall(LIVE_NOTES, DROPPED_BRIEF, [])).toEqual(NO_SHORTFALL);
    expect(briefProductShortfall(undefined, DROPPED_BRIEF, CATALOGUE)).toEqual(NO_SHORTFALL);
  });

  it('survives a catalogue carrying blanks and a regex metacharacter', () => {
    const messy = ['', '   ', 'Maggie', 'A+B'] as string[];
    expect(briefProductShortfall('Launch Maggie and A+B', { schedule: [] }, messy).missing)
      .toEqual(['Maggie', 'A+B']);
  });
});
