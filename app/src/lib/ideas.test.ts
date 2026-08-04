/**
 * ideas.test.ts — the state a client is shown, derived from two columns that mean different
 * things.
 *
 * `status` is AVAILABILITY, `lifecycle` is MATURITY, and the reason they cannot be merged is the
 * reason this derivation needs pinning: a 'proven' idea is still 'active', so reading either
 * column alone gives a confident wrong answer. Every case below is a real combination the table
 * holds today or can reach by its documented transitions.
 */
import { describe, it, expect } from 'vitest';
import { ideaState, ideaStateLabel, postHeadline, sortIdeas, type IdeaView } from './ideas';

const row = (over: Partial<{ type: string; status: string; lifecycle: string }> = {}) =>
  ({ type: 'idea', status: 'active', lifecycle: 'candidate', ...over });

describe('ideaState', () => {
  it('the plain case: on record, nothing has happened to it', () => {
    expect(ideaState(row())).toBe('waiting');
  });

  it('reads USED off lifecycle even though status still says active', () => {
    // This is the whole reason the derivation exists. 14 rows in UAT are exactly this shape,
    // and a reader that trusted `status` would call every one of them "waiting" — telling a
    // client we had ignored ideas we had in fact already published.
    for (const lifecycle of ['used', 'measured', 'proven']) {
      expect(ideaState(row({ status: 'active', lifecycle }))).toBe('used');
    }
  });

  it('reads USED off status when a proposal consumed it', () => {
    // The other direction: `markNoteIntegrated` writes status, not lifecycle.
    expect(ideaState(row({ type: 'note', status: 'integrated', lifecycle: 'candidate' }))).toBe('used');
  });

  it('a declined or stale idea is SET ASIDE, never "waiting"', () => {
    // "Waiting" is a promise that it might still happen. Saying it about something we turned
    // down is the one failure mode this view could have that a client would call a lie.
    expect(ideaState(row({ lifecycle: 'declined' }))).toBe('set-aside');
    expect(ideaState(row({ lifecycle: 'stale' }))).toBe('set-aside');
    expect(ideaState(row({ status: 'dismissed' }))).toBe('set-aside');
    expect(ideaState(row({ status: 'expired' }))).toBe('set-aside');
  });

  it('a next_cycle input is DEFERRED — the one state the client chose themselves', () => {
    expect(ideaState(row({ type: 'next_cycle' }))).toBe('deferred');
  });

  it('USED outranks deferred: an input held back, then picked up early, reads as used', () => {
    expect(ideaState(row({ type: 'next_cycle', lifecycle: 'used' }))).toBe('used');
  });

  it('SET ASIDE outranks deferred: a held-back idea that was then declined is not still pending',
    () => { expect(ideaState(row({ type: 'next_cycle', lifecycle: 'declined' }))).toBe('set-aside'); });
});

describe('ideaStateLabel', () => {
  it('names the month a used idea ran in', () => {
    expect(ideaStateLabel('used', 'September 2026')).toBe('Used in September 2026');
  });

  it('stops at "Used" rather than trailing off when the cycle is not on record', () => {
    // `used_in_cycle_id` is nullable. "Used in " with nothing after it is worse than "Used".
    expect(ideaStateLabel('used', null)).toBe('Used');
    expect(ideaStateLabel('used', null)).not.toContain('in');
  });

  it('the other three carry no month, so a month never leaks into them', () => {
    expect(ideaStateLabel('waiting', 'September 2026')).toBe('Waiting');
    expect(ideaStateLabel('deferred', 'September 2026')).toBe('Deferred to next month');
    expect(ideaStateLabel('set-aside', 'September 2026')).toBe('Set aside');
  });
});

describe('sortIdeas', () => {
  const idea = (id: string, state: IdeaView['state'], createdAt: string): IdeaView =>
    ({ id, content: id, createdAt, state, usedInMonth: null, usedInCycleId: null, postId: null, postTitle: null });

  it('puts what is still live first and what is finished last', () => {
    const out = sortIdeas([
      idea('d', 'set-aside', '2026-05-01T00:00:00.000Z'),
      idea('c', 'used', '2026-05-01T00:00:00.000Z'),
      idea('b', 'deferred', '2026-05-01T00:00:00.000Z'),
      idea('a', 'waiting', '2026-05-01T00:00:00.000Z'),
    ]);
    expect(out.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('newest first inside a group', () => {
    const out = sortIdeas([
      idea('old', 'waiting', '2026-01-02T00:00:00.000Z'),
      idea('new', 'waiting', '2026-07-02T00:00:00.000Z'),
    ]);
    expect(out.map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('does not mutate the array it was given', () => {
    const input = [idea('b', 'used', '2026-01-01T00:00:00.000Z'), idea('a', 'waiting', '2026-01-01T00:00:00.000Z')];
    sortIdeas(input);
    expect(input.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

/**
 * `postHeadline` was `postTitle`'s body until the Ideas reader needed the same string on the
 * server. It is one rule in one place now, so these cases guard BOTH callers: the card title on
 * the plan surface and the tap-through label in Ideas cannot say different things about the
 * same post.
 */
describe('postHeadline', () => {
  it('is the caption’s first sentence', () => {
    expect(postHeadline('Wilderness is back. Cedarwood, damp earth, and open air.'))
      .toBe('Wilderness is back.');
  });

  it('keeps a caption that never ends a sentence, capped at 90', () => {
    expect(postHeadline('a'.repeat(200))).toHaveLength(90);
  });

  it('splits on ! and ? as well as a full stop', () => {
    expect(postHeadline('Back in stock! Finally.')).toBe('Back in stock!');
    expect(postHeadline('Remember these? They sold out.')).toBe('Remember these?');
  });

  it('has nothing to say about an empty or placeholder caption', () => {
    // The assembler writes "Draft idea …" into an unwritten post. It is scaffolding, not a
    // title, and quoting it back at a client as what their idea became would be worse than
    // saying nothing.
    expect(postHeadline('')).toBeNull();
    expect(postHeadline('   ')).toBeNull();
    expect(postHeadline(null)).toBeNull();
    expect(postHeadline(undefined)).toBeNull();
    expect(postHeadline('Draft idea — provenance')).toBeNull();
  });
});
