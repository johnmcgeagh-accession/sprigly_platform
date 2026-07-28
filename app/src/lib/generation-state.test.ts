/**
 * generation-state.test.ts — the client is never told a generation failed.
 *
 * Spec G4. Two halves, and both are asserted here:
 *
 *   1. `generating` and `generation_failed` collapse into ONE client state. A surface that
 *      forked on them would eventually render the second honestly, which is the thing G4
 *      forbids.
 *   2. No string this module offers a client contains failure or retry vocabulary — checked
 *      against the words rather than by reading, because the way this regresses is somebody
 *      adding a fourth string in a hurry.
 *
 * The vocabulary rule is only defensible because the recovery exists: the sweep gives a
 * `generation_failed` post two more passes, and the one that runs out reaches an operator.
 * If gap 7's first half were ever reverted, these tests would still pass and the copy would
 * become a lie — which is why the sweep has its own tests rather than leaning on these.
 */
import { describe, it, expect } from 'vitest';
import type { PostStatus } from '@/lib/types';
import {
  isOnTheWay, ON_THE_WAY_LABEL, ON_THE_WAY_TEASER, ON_THE_WAY_BODY, ON_THE_WAY_ARIA,
} from '@/lib/generation-state';

const ALL_STATUSES: PostStatus[] = ['planned', 'edited', 'new', 'generating', 'generation_failed', 'draft'];

describe('one client-facing state, not two', () => {
  it('a post still generating is on its way', () => {
    expect(isOnTheWay('generating')).toBe(true);
  });

  it('a post whose generation ran out of attempts is ALSO on its way — the sweep has it', () => {
    expect(isOnTheWay('generation_failed')).toBe(true);
  });

  it('nothing else is', () => {
    const rest = ALL_STATUSES.filter((s) => s !== 'generating' && s !== 'generation_failed');
    expect(rest.map(isOnTheWay)).toEqual(rest.map(() => false));
  });

  it('absent or unknown reads as not in flight, so an empty card never claims to be writing', () => {
    expect(isOnTheWay(undefined)).toBe(false);
    expect(isOnTheWay(null)).toBe(false);
  });
});

describe('the words', () => {
  const CLIENT_STRINGS = [ON_THE_WAY_LABEL, ON_THE_WAY_TEASER, ON_THE_WAY_BODY, ON_THE_WAY_ARIA];

  // 'beat' is the internal word for a slot with evidence and no content (spec §7); the rest is
  // the failure vocabulary G4 removes.
  const FORBIDDEN = /\b(retry|retried|retrying|fail|failed|failure|error|broken|beat)\b/i;

  it('carry no failure or retry vocabulary at all', () => {
    for (const s of CLIENT_STRINGS) {
      expect(s, `"${s}" uses vocabulary the client surface may not`).not.toMatch(FORBIDDEN);
    }
  });

  it('say that nothing is being asked of the client', () => {
    expect(ON_THE_WAY_BODY).toContain('nothing you need to do');
  });

  it('are phrased as continuation, not as an outcome', () => {
    expect(ON_THE_WAY_LABEL).toBe('On its way');
    expect(ON_THE_WAY_TEASER).toContain('still writing');
  });
});
