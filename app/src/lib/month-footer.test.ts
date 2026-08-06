import { describe, it, expect } from 'vitest';
import { monthFooterParts } from '@/lib/month-footer';

/** The sentence as a client reads it, control and all. */
const sentence = (o: Parameters<typeof monthFooterParts>[0]) => {
  const p = monthFooterParts(o);
  return p.before + (p.ask ?? '') + p.after;
};

const base = { total: 27, monthWord: 'September' };

describe('the month footer', () => {
  it('says what the month holds, and how to open it, when nothing is pending', () => {
    expect(sentence({ ...base, inFlight: 0, waiting: 0 }))
      .toBe('27 posts across September. Tap a day to open it.');
    expect(monthFooterParts({ ...base, inFlight: 0, waiting: 0 }).ask).toBeNull();
  });

  it('counts every post, whatever state it is in', () => {
    // A declined post exists and is scheduled; it just has no words. The count is what EXISTS,
    // and only the clause after it is state-aware.
    expect(sentence({ ...base, inFlight: 0, waiting: 3 })).toContain('27 posts across September.');
    expect(sentence({ total: 1, monthWord: 'September', inFlight: 0, waiting: 0 }))
      .toBe('1 post across September. Tap a day to open it.');
    expect(sentence({ total: 0, monthWord: 'September', inFlight: 0, waiting: 0 }))
      .toBe('Nothing planned across September yet.');
  });

  it('keeps the in-flight clause exactly as it read before', () => {
    expect(sentence({ ...base, inFlight: 1, waiting: 0 }))
      .toBe('27 posts across September. One is still being written.');
    expect(sentence({ ...base, inFlight: 3, waiting: 0 }))
      .toBe('27 posts across September. 3 are still being written.');
  });

  it('asks for what it needs, and the ask is the tappable part', () => {
    expect(sentence({ ...base, inFlight: 0, waiting: 3 }))
      .toBe('27 posts across September. 3 need a word from you.');
    expect(sentence({ ...base, inFlight: 0, waiting: 1 }))
      .toBe('27 posts across September. One needs a word from you.');

    const p = monthFooterParts({ ...base, inFlight: 0, waiting: 3 });
    expect(p.ask).toBe('3 need a word from you');
    // The control carries the whole clause and none of the punctuation around it — otherwise
    // the tap target is a sentence fragment or swallows the full stop.
    expect(p.before.endsWith(' ')).toBe(true);
    expect(p.after).toBe('.');
  });

  it('does not let two equal counts read as one group described twice', () => {
    // The awkward case, and the reason `another` is in the wording at all.
    expect(sentence({ ...base, inFlight: 2, waiting: 2 }))
      .toBe('27 posts across September. 2 are still being written, and another 2 need a word from you.');
    expect(sentence({ ...base, inFlight: 3, waiting: 2 }))
      .toBe('27 posts across September. 3 are still being written, and another 2 need a word from you.');
    expect(sentence({ ...base, inFlight: 1, waiting: 1 }))
      .toBe('27 posts across September. One is still being written, and another needs a word from you.');
  });

  it('never offers a count with no way to reach it', () => {
    // The whole point: whenever the sentence names something waiting, the naming IS the control.
    for (const [inFlight, waiting] of [[0, 1], [0, 5], [2, 2], [4, 1]] as const) {
      expect(monthFooterParts({ ...base, inFlight, waiting }).ask).not.toBeNull();
    }
    for (const [inFlight, waiting] of [[0, 0], [3, 0]] as const) {
      expect(monthFooterParts({ ...base, inFlight, waiting }).ask).toBeNull();
    }
  });
});
