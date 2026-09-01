/**
 * status-allowlist.test.ts — the tripwire on a mistake that leaves no trace.
 *
 * ── The hazard ───────────────────────────────────────────────────────────────────────
 *
 * `plan.ts` validates a row's status against `POST_STATUSES` and coerces anything absent to
 * 'planned'. No throw, no log, no red anywhere. So a PostStatus member that never reaches the
 * allowlist does not present as a broken build or a failing request — it presents as a post
 * that renders as an ordinary untouched slot on the client's calendar. The retired post added
 * in this change would look like a blank day nobody had got to yet, and the whole point of
 * retiring it was to stop it lying.
 *
 * ── Why these assertions are shaped the way they are ─────────────────────────────────
 *
 * A test that only asserted `POST_STATUSES.includes('generation_expired')` would pass today and
 * say nothing about the NEXT member somebody adds. So the first test derives its expectation
 * from the union itself: `Record<PostStatus, true>` fails to compile if a member is missing,
 * which means adding a status without listing it here is a build error naming the member —
 * not a green suite. The runtime assertion then catches the other direction, where the two
 * lists drift apart at runtime.
 */
import { describe, it, expect } from 'vitest';
import { POST_STATUSES } from './types';
import type { PostStatus } from './types';

/**
 * EVERY member of the union, restated deliberately.
 *
 * This is the tripwire and the duplication is the mechanism, not an oversight. Adding a member
 * to PostStatus without adding it here is `error TS2741: Property 'x' is missing`. Adding it
 * here without adding it to the union is `error TS2353`. The two cannot drift, and the failure
 * arrives at build time with the member's name in it.
 */
const EXPECTED: Record<PostStatus, true> = {
  planned:            true,
  edited:             true,
  new:                true,
  generating:         true,
  generation_failed:  true,
  generation_expired: true,
  draft:              true,
};

describe('the PostStatus allowlist', () => {
  it('contains every member of the union — a missing one is coerced to "planned" in silence', () => {
    const expected = Object.keys(EXPECTED).sort();
    expect([...POST_STATUSES].sort()).toEqual(expected);
  });

  it('contains no member the union does not have', () => {
    // The other direction. A stale entry here would let a status the app no longer understands
    // through `toPlanPost` untouched, to be switched on by nothing and rendered by nothing.
    for (const s of POST_STATUSES) {
      expect(Object.prototype.hasOwnProperty.call(EXPECTED, s)).toBe(true);
    }
  });

  it('includes the retired state specifically, because its absence is invisible', () => {
    // Named on its own as well as covered above: this is the member whose omission would have
    // silently undone the change it belongs to.
    expect(POST_STATUSES).toContain('generation_expired');
  });

  it('still includes every status that existed before it', () => {
    // A regression guard on the refactor that moved this list out of plan.ts: dropping a member
    // while relocating would have been a silent behaviour change for every existing post.
    for (const s of ['planned', 'edited', 'new', 'generating', 'generation_failed', 'draft']) {
      expect(POST_STATUSES).toContain(s as PostStatus);
    }
  });
});
