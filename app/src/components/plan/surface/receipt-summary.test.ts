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
import { evergreenCopy, threadMessage } from '@/lib/receipt-copy';
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

  /**
   * Six reasons reached an evergreen receipt and five said the same sentence: "Saved to your
   * ideas", the copy for a filing the client ASKED FOR. The honest branch could only fire when
   * classifyIntake threw twice, so it was unreachable from every failure that actually happens —
   * including "can you move one of the posts to the next available empty day?", read as a
   * standing idea and reported back as a deliberate filing.
   */
  it('tells a suspected misread apart from a filing the client asked for', () => {
    expect(chipLabel(receipt({ scope: 'evergreen', reason: 'read_as_idea' })))
      .toBe('Saved as an idea — not a change');
    // The common case is unchanged: a real idea still reads as one.
    expect(chipLabel(receipt({ scope: 'evergreen', reason: 'classified_evergreen' })))
      .toBe('Saved to your ideas');
  });

  it('does not call a success a failure', () => {
    // `not_applicable` means the transform RAN and had nothing to do — a cadence floor already
    // met returns no ops with the note "Recorded 7 posts a week as your floor. You have 9 posts
    // this month". Folding that in with couldnt_apply was giving a success the words of a failure.
    expect(chipLabel(receipt({ scope: 'evergreen', reason: 'not_applicable' })))
      .toBe('Nothing needed changing');
    expect(chipLabel(receipt({ scope: 'evergreen', reason: 'validation_failed' })))
      .toBe('We couldn’t apply that');
  });

  it('asks for a retry when the retry is the thing that will work', () => {
    expect(chipLabel(receipt({ scope: 'evergreen', reason: 'model_error' })))
      .toBe('We couldn’t read that');
  });

  it('is EMPTY when nothing happened — a chip reading "0 changes" spends 48px to say nothing', () => {
    expect(chipLabel(receipt())).toBe('');
    expect(chipLabel(null)).toBe('');
  });
});

/**
 * THE COPY AND THE BUTTON COME FROM ONE PLACE.
 *
 * Three components carried their own `reason === 'couldnt_apply'` ternary, which is how the chip
 * comes to say one thing over a panel saying another. `evergreenCopy` is the rule; `chipLabel`
 * above is the same FAMILIES in the chip's register, and these pin the two together.
 */
describe('evergreenCopy', () => {
  const M = 'September';

  it('withholds the rescue tap on a suspected misread, and only there', () => {
    // Not a copy decision. `addBacklogItemToMonth` re-routes the filed row as kind:'event' with
    // its first 80 characters as the subject and displaces the weakest beat, so the one button
    // offered would title a post with the client's instruction and evict a real one.
    expect(evergreenCopy('read_as_idea', M).rescue).toBe(false);
    expect(evergreenCopy('model_error', M).rescue).toBe(false);
    for (const r of ['classified_evergreen', 'ambiguous', 'couldnt_apply', 'validation_failed', 'not_applicable']) {
      expect(evergreenCopy(r, M).rescue).toBe(true);
    }
  });

  it('states rather than asks — a question would be answered through the classifier that failed', () => {
    const { heading, body } = evergreenCopy('read_as_idea', M);
    expect(heading).toBe('Saved as an idea — not a change to September');
    expect(heading).not.toContain('?');
    // It names the shape that does work, which is the one thing that gets a client unstuck.
    expect(body).toContain('which post and which date');
  });

  it('never calls a success a failure', () => {
    expect(evergreenCopy('not_applicable', M).heading).toBe('Nothing changed in September');
    expect(evergreenCopy('not_applicable', M).heading).not.toContain('couldn’t');
  });

  it('says a system failure is one, and asks for the retry that will fix it', () => {
    expect(evergreenCopy('couldnt_apply', M).heading).toBe('We couldn’t apply this');
    expect(evergreenCopy('validation_failed', M).heading).toBe('We couldn’t apply this');
    expect(evergreenCopy('model_error', M).body).toContain('try saying it again');
    // saveToBacklog runs for every evergreen reason, so this is a fact and not reassurance.
    expect(evergreenCopy('model_error', M).body).toContain('It’s saved');
  });

  it('leaves the common case exactly as it was', () => {
    const { heading, body, rescue } = evergreenCopy('classified_evergreen', M);
    expect(heading).toBe('Saved to your ideas');
    expect(body).toBe('We’ve kept this for later rather than changing September. If you meant now, add it to this month.');
    expect(rescue).toBe(true);
  });

  /**
   * THE THREAD IS THE FIFTH EMITTER, and it was the one that could not read the families.
   *
   * Live, one commit after the panel and chip were unified:
   *   "Saved to your ideas — nothing on the month changed.Saved as an idea — not a change to
   *    September"
   * The first sentence came from DraftSurface's submit handler, which branched on `scope` alone.
   * It prefixed FIVE of the six families; four contradicted the panel outright and
   * `classified_evergreen` was doubled-but-agreeing, which is why it survived unnoticed.
   */
  it('the thread turn carries the family, not a sentence of its own', () => {
    const ever = (reason: string, over: Partial<{ note: string }> = {}) =>
      threadMessage({ scope: 'evergreen', reason, lines: [], ...over }, M);
    expect(ever('read_as_idea')).toBe(evergreenCopy('read_as_idea', M).body);
    expect(ever('couldnt_apply')).toBe(evergreenCopy('couldnt_apply', M).body);
    expect(ever('model_error')).toBe(evergreenCopy('model_error', M).body);
    // The generic sentence is gone from every family, including the one it happened to agree with.
    for (const r of ['read_as_idea', 'couldnt_apply', 'validation_failed', 'not_applicable', 'model_error', 'classified_evergreen']) {
      expect(ever(r)).not.toContain('nothing on the month changed');
    }
  });

  it('NOTE-FIRST: not_applicable is the one family whose thread turn does not change', () => {
    // A transform's own note is strictly more specific than any family sentence, and it already
    // agrees with that family's heading. It is also why `not_applicable` was the one family the
    // generic line never reached.
    const note = 'Recorded 7 posts a week as your floor. You have 9 posts this month';
    expect(threadMessage({ scope: 'evergreen', reason: 'not_applicable', lines: [], note }, M)).toBe(note);
    // Diff lines still outrank everything — an applied change narrates itself.
    expect(threadMessage({ scope: 'month_scoped', lines: ['Moved: a, Mon 3 Aug → Tue 4 Aug'] }, M))
      .toBe('Moved: a, Mon 3 Aug → Tue 4 Aug');
  });

  it('every family the chip knows is a family the panel knows', () => {
    for (const r of ['read_as_idea', 'not_applicable', 'model_error', 'couldnt_apply', 'validation_failed']) {
      const chip = chipLabel({ id: 'r', at: '', sourceText: 'x', scope: 'evergreen', reason: r, lines: [], changedIds: [] } as DraftReceipt);
      expect(chip).not.toBe('Saved to your ideas');       // none of these is a deliberate filing
      expect(evergreenCopy(r, M).heading).not.toBe('Saved to your ideas');
    }
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
