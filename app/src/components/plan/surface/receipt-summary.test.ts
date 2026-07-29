/**
 * receipt-summary.test.ts — the chip's numbers, pinned to the receipt's own strings.
 *
 * The lines below are `draft-diff.ts`'s real output format, not invented ones. That is the whole
 * point of testing this file: the chip must count what the diff SAID, so a verb added there
 * without landing here fails a test rather than quietly producing a wrong number on the one
 * element whose job is to be trusted.
 */
import { describe, it, expect } from 'vitest';
import { countVerbs, countItems, chipLabel, rollupHeadline } from './receipt-summary';
import type { DraftReceipt, BriefItem } from '../DraftPlanView';

const receipt = (over: Partial<DraftReceipt> = {}): DraftReceipt => ({
  id: 'r1', at: '2026-07-29T10:00:00Z', sourceText: 'x', scope: 'month_scoped',
  lines: [], changedIds: [], ...over,
});

const item = (over: Partial<BriefItem> = {}): BriefItem => ({
  span: 'a segment', outcome: 'applied', lines: [], changedIds: [], ...over,
});

describe('countVerbs', () => {
  /** ivy-t's rehearsal receipt, verbatim in shape: a launch arc that paid for itself. */
  const ARC = [
    'Added: The Navy Edit — Tease, Wed 26 Aug',
    'Added: The Navy Edit — Launch, Fri 28 Aug',
    'Added: The Navy Edit — Follow, Sun 30 Aug',
    'Replaced: Understands Real Women — Reel, Wed 26 Aug',
    'Replaced: Sustainable & Considered — Single post, Fri 28 Aug',
    'Replaced: Quality & Craft — Carousel, Sun 30 Aug',
  ];

  it('counts the receipt’s own verbs', () => {
    expect(countVerbs(ARC)).toEqual([{ word: 'added', count: 3 }, { word: 'replaced', count: 3 }]);
  });

  it('keeps REPLACED distinct from changed — that difference is the point', () => {
    // "edited" and "removed, and another took its slot" are different facts, and the second is
    // what went wrong in ivy-t's rehearsal.
    const out = countVerbs(['Replaced: a, Mon 3 Aug', 'Changed: b, reel → carousel']);
    expect(out).toEqual([{ word: 'replaced', count: 1 }, { word: 'changed', count: 1 }]);
  });

  it('states them in one canonical order regardless of the lines’ order', () => {
    expect(countVerbs(['Moved: a, Mon 3 Aug → Tue 4 Aug', 'Added: b, Wed 5 Aug']))
      .toEqual([{ word: 'added', count: 1 }, { word: 'moved', count: 1 }]);
  });

  it('carries the rarer field edits in the same vocabulary', () => {
    expect(countVerbs(['Re-angled: a, Quality → Craft', 'Renamed: a → b']))
      .toEqual([{ word: 're-angled', count: 1 }, { word: 'renamed', count: 1 }]);
  });

  it('ignores a line it does not recognise rather than miscounting it', () => {
    // A verb added to draft-diff.ts without landing here shows up as absent, not as wrong.
    expect(countVerbs(['Reordered: a, Mon 3 Aug'])).toEqual([]);
  });

  it('is empty for an empty receipt', () => {
    expect(countVerbs([])).toEqual([]);
  });
});

describe('countItems', () => {
  /** Sally's August brief: 14 segments, 8 applied, 6 filed (brief-decomposer.md §COMMIT 4). */
  const SALLY = [
    ...Array.from({ length: 8 }, () => item({ lines: ['Added: x, Fri 7 Aug'] })),
    ...Array.from({ length: 6 }, () => item({ outcome: 'idea' })),
  ];

  it('counts a real decomposed brief the way the report does', () => {
    expect(countItems(SALLY)).toEqual([{ word: 'applied', count: 8 }, { word: 'saved', count: 6 }]);
  });

  it('never folds “couldn’t apply” into “saved” — the silent demotion is the fault', () => {
    const out = countItems([item(), item({ outcome: 'idea' }), item({ outcome: 'couldnt_apply' })]);
    expect(out).toEqual([
      { word: 'applied', count: 1 }, { word: 'saved', count: 1 }, { word: 'couldn’t apply', count: 1 },
    ]);
  });

  it('does not print a zero row', () => {
    expect(countItems([item()])).toEqual([{ word: 'applied', count: 1 }]);
  });

  it('leaves a noop uncounted — “0 changes” is padding', () => {
    expect(countItems([item({ outcome: 'noop' })])).toEqual([]);
  });
});

describe('chipLabel', () => {
  it('is the counts, and nothing else — no heading, no verb of ours', () => {
    expect(chipLabel(receipt({ lines: ['Added: a, Fri 7 Aug'] }))).toBe('1 added');
    expect(chipLabel(receipt({ lines: ['Added: a, Fri 7 Aug', 'Moved: b, Mon 3 → Tue 4 Aug'] })))
      .toBe('1 added · 1 moved');
  });

  it('reads a rollup as applied and saved', () => {
    expect(chipLabel(receipt({ items: [item(), item({ outcome: 'idea' })], segmentCount: 2 })))
      .toBe('1 applied · 1 saved');
  });

  it('says where an evergreen filing went, because the client asked for something', () => {
    expect(chipLabel(receipt({ scope: 'evergreen' }))).toBe('Saved to your ideas');
    expect(chipLabel(receipt({ scope: 'evergreen', reason: 'couldnt_apply' }))).toBe('We couldn’t apply that');
  });

  it('is EMPTY when nothing happened — a chip reading "0 changes" spends 48px to say nothing', () => {
    expect(chipLabel(receipt())).toBe('');
    expect(chipLabel(null)).toBe('');
  });
});

describe('rollupHeadline', () => {
  it('renders the DECOMPOSER’s count, not a re-count of what we chose to display', () => {
    // The fixture splits Sally's brief into 14; the round-1 brief said 13. segmentCount wins.
    expect(rollupHeadline(receipt({ items: [item()], segmentCount: 14 })))
      .toBe('We found 14 things in what you sent');
  });

  it('is singular for one', () => {
    expect(rollupHeadline(receipt({ items: [item()], segmentCount: 1 })))
      .toBe('We found 1 thing in what you sent');
  });
});
