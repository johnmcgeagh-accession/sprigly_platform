/**
 * cardinality.test.ts — "a post" is not "the posts".
 *
 * `requestedCount` reads the client's own sentence. The contract has two halves and the
 * second is the one worth guarding: a phrasing it does not recognise must return null (the
 * caller then moves everything, exactly as it did before this existed) and must NEVER return
 * a guess. A parser that guessed would turn an unqualified date reference into a silent
 * partial move, which is the same class of failure as the one it was written to fix.
 */
import { describe, it, expect } from 'vitest';
import { requestedCount } from './draft-transforms.js';

describe('one', () => {
  it.each([
    'move a post from the 17th to the week before',
    'move a single post from the 17th',
    'move the post from the 17th to the 10th',
    'move one post from the 17th',
    'move one of the posts on the 17th to the 10th',
    'I only wanted one of those moving',
    'just one of them please',
    'only one — put the rest back',
    'move another post to the 10th',
  ])('%s', (s) => expect(requestedCount(s)).toBe(1));
});

describe('a stated number, in digits or words', () => {
  it.each([
    ['move 2 posts from the 10th to the 17th', 2],
    ['move two posts from the 10th to the 17th', 2],
    ['move 3 of them to the 24th', 3],
    ['move three of those to the 24th', 3],
    ['can you move 2 more posts to the 10th', 2],
    ['move both posts from the 17th', 2],
    ['both of them to the 10th', 2],
    ['move twelve posts', 12],
  ])('%s → %i', (s, n) => expect(requestedCount(s)).toBe(n));
});

describe('all — null, meaning the caller moves everything', () => {
  it.each([
    'move the posts from the 17th to the 10th',
    'move everything on the 17th to the 10th',
    'move all of them to the 10th',
    'move all 3 posts from the 17th',
    'move all the posts on the 17th',
    'move them all back',
    'move the whole day to the 10th',
  ])('%s', (s) => expect(requestedCount(s)).toBeNull());
});

/**
 * The unqualified case — the client named a date and no quantity.
 *
 * Null, so the caller moves everything and the receipt states the count. Operator ruling:
 * this is today's behaviour and it stays, because a phrasing that works now must not
 * silently start doing less.
 */
describe('unqualified — null', () => {
  it.each([
    'move the 17th to the 10th',
    'move the 17th back a week',
    'can we shift the 22nd to the 25th',
  ])('%s', (s) => expect(requestedCount(s)).toBeNull());
});

/**
 * DELIBERATELY NOT HANDLED. Each returns null and moves everything — the documented
 * fall-through. These are pinned so that adding support for one is a visible decision
 * rather than an accident, and so nobody "fixes" a passing test into a guess.
 */
describe('not handled — falls through to null, never to a guess', () => {
  it.each([
    ['ordinal selection',  'move the second post on the 17th to the 10th'],
    ['fuzzy quantity',     'move a couple of posts from the 17th'],
    ['fuzzy quantity',     'move most of them to the 10th'],
    ['fuzzy quantity',     'move a few posts back'],
    ['exclusion',          'move all but one of the posts on the 17th'],
    ['exclusion',          'move everything except the reel'],
  ])('%s: %s', (_kind, s) => expect(requestedCount(s)).toBeNull());
});

describe('it does not fire on numbers that are not counts of posts', () => {
  it('a number in a title is not a quantity', () => {
    expect(requestedCount('move the top 5 tips post to the 17th')).toBeNull();
  });
  it('a date is not a quantity', () => {
    expect(requestedCount('move the 17th to the 10th')).toBeNull();
  });
  it('"3 weeks" is not 3 posts', () => {
    expect(requestedCount('move it back 3 weeks')).toBeNull();
  });
  it('empty and whitespace are null, not zero', () => {
    expect(requestedCount('')).toBeNull();
    expect(requestedCount('   ')).toBeNull();
  });
});

describe('"the posts" is plural and "the post" is not', () => {
  it('distinguishes them on the trailing s alone', () => {
    expect(requestedCount('move the post on the 17th')).toBe(1);
    expect(requestedCount('move the posts on the 17th')).toBeNull();
  });
});
