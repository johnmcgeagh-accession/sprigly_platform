/**
 * brief-summary test — the projection the capture surface reads a SAVED brief through.
 *
 * The null cases carry the weight. This runs on every plan page load, over a jsonb column that
 * is deliberately cleared mid-flight on every intake change, so "the brief isn't there / isn't
 * the shape we expect" is an ordinary Tuesday and must cost the client an empty panel, never
 * their page.
 */
import { describe, it, expect } from 'vitest';
import { shortDate, summariseBrief, summariseSavedBrief } from './brief-summary';

const BRIEF = {
  products: [
    { product: 'Hannah', colourway: 'green', status: 'new', launch_date: '2026-09-15', content_from: null },
    { product: 'Sally', colourway: null, status: 'restock', launch_date: null, content_from: null },
  ],
  schedule: [
    { date: '2026-09-15', dateRange: null, type: 'launch', product: 'Hannah', colourway: 'green', note: '' },
    { date: null, dateRange: { start: '2026-09-18', end: '2026-09-30' }, type: 'london-fashion-week', product: null, colourway: null, note: '' },
  ],
  content_asks: [{ type: 'behind-the-scenes', product: 'Hannah' }, { type: 'autumn-transition', product: null }],
  focus: [], conflicts: [], plan_window: { from: null, month: '2026-09' },
};

describe('shortDate', () => {
  it('renders an ISO day in the client-facing short form', () => {
    expect(shortDate('2026-09-15')).toBe('15 Sep');
  });
  it('returns anything unparseable untouched rather than inventing a date', () => {
    expect(shortDate('soon')).toBe('soon');
    expect(shortDate('')).toBe('');
  });
});

describe('summariseBrief', () => {
  it('names launches and restocks distinctly, and folds a colourway into the product name', () => {
    expect(summariseBrief(BRIEF as never).launches).toEqual(['Hannah in green — new', 'Sally — restock']);
  });

  it('renders a single day and a range in the same "when" slot', () => {
    expect(summariseBrief(BRIEF as never).dates).toEqual([
      { when: '15 Sep', label: 'Hannah' },
      { when: '18 Sep–30 Sep', label: 'london fashion week' },
    ]);
  });

  it('de-hyphenates ask types and qualifies them by product where there is one', () => {
    expect(summariseBrief(BRIEF as never).asks).toEqual(['behind the scenes (Hannah)', 'autumn transition']);
  });
});

describe('summariseSavedBrief — the stored-column boundary', () => {
  it('summarises a well-formed stored brief', () => {
    expect(summariseSavedBrief(BRIEF)?.launches).toEqual(['Hannah in green — new', 'Sally — restock']);
  });

  // structured_brief is nullable BY DESIGN: clearStructuredBriefIfPrePlanning nulls it on every
  // intake change, before the fresh extraction re-persists it. A reader between those two writes
  // is a normal event, not a fault.
  it('returns null for the cleared column', () => {
    expect(summariseSavedBrief(null)).toBeNull();
    expect(summariseSavedBrief(undefined)).toBeNull();
  });

  it('returns null rather than throwing on a shape it does not recognise', () => {
    expect(summariseSavedBrief('a string')).toBeNull();
    expect(summariseSavedBrief(42)).toBeNull();
    expect(summariseSavedBrief({})).toBeNull();
    expect(summariseSavedBrief({ products: [], schedule: 'not an array', content_asks: [] })).toBeNull();
  });

  it('returns null for a brief that extracted nothing — the empty state says more than empty groups', () => {
    expect(summariseSavedBrief({ products: [], schedule: [], content_asks: [] })).toBeNull();
  });

  it('a brief carrying only content_asks still earns the panel', () => {
    const only = { products: [], schedule: [], content_asks: [{ type: 'autumn-transition', product: null }] };
    expect(summariseSavedBrief(only)).toEqual({ launches: [], dates: [], asks: ['autumn transition'] });
  });
});
