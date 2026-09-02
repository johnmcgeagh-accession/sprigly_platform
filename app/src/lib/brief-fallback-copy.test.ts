/**
 * brief-fallback-copy.test.ts — what the client is told when the brief was never read.
 *
 * The sentence this replaces: "Saved as an idea — not a change to October. This read as
 * something for later." It was false. A fifteen-item brief reached the SINGLE-INSTRUCTION path
 * because decomposition failed, and that path's contract returns one scope and one intent —
 * `evergreen` was the only answer it could represent, not a judgement about the content.
 */
import { describe, it, expect } from 'vitest';
import { evergreenCopy, evergreenChip, offersRescue, RECEIPT_REASONS } from './receipt-copy';

const M = 'October';

describe('not_decomposed — the honest sentence', () => {
  it('does not claim the brief was read as anything', () => {
    const { heading, body } = evergreenCopy('not_decomposed', M);
    expect(body).not.toMatch(/read as something for later/i);
    expect(body).toContain('couldn’t read this as separate instructions');
    expect(body).toContain('none of it was judged');
    expect(heading).toContain('October is unchanged');
  });

  it('says the words are kept — that is a fact, saveToBacklog runs for every evergreen reason', () => {
    expect(evergreenCopy('not_decomposed', M).body).toContain('Every word is saved');
  });

  it('offers the remedy that works, not the one for a misread instruction', () => {
    const body = evergreenCopy('not_decomposed', M).body;
    expect(body).toContain('one at a time');
    // "tell me which post and which date" is read_as_idea's advice and is wrong here: the
    // client wrote nothing wrong, and rewording is not what fixes a split we could not do.
    expect(body).not.toMatch(/which post and which date/i);
  });

  it('is not offered a rescue — promoting a whole brief would title one post with fifteen asks', () => {
    expect(evergreenCopy('not_decomposed', M).familyRescue).toBe(false);
    expect(offersRescue({ scope: 'evergreen', reason: 'not_decomposed', sourceText: 'move the 21st to the 30th' })).toBe(false);
  });

  it('has its own chip, distinct from the generic filing', () => {
    expect(evergreenChip('not_decomposed')).not.toBe('Saved to your ideas');
    expect(evergreenChip('not_decomposed')).not.toBe(evergreenChip('read_as_idea'));
  });

  it('is a member of the closed reason set', () => {
    expect(RECEIPT_REASONS).toContain('not_decomposed');
  });

  it('reads differently from read_as_idea, which is a real judgement', () => {
    // read_as_idea means the classifier DID read it and called it a standing idea. Keeping the
    // two apart is the whole point: one is a verdict, the other is the absence of one.
    expect(evergreenCopy('not_decomposed', M).heading).not.toBe(evergreenCopy('read_as_idea', M).heading);
  });
});
