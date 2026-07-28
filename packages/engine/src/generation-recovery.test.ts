/**
 * generation-recovery.test.ts — the shared facts behind "on its way" (spec gap 7).
 *
 * Three consumers read these: the fan-out enqueues with the instruction, the worker's daily
 * sweep enforces the bound, and admin's failed-posts list renders it. Pinning them here is
 * what stops the three drifting into disagreement about how many goes a post gets.
 */
import { describe, it, expect } from 'vitest';
import { captionInstruction, sweepAttemptsOf, sweepExhausted, MAX_SWEEP_ATTEMPTS, SWEEP_ATTEMPTS_KEY } from './generation-recovery.js';

describe('captionInstruction', () => {
  it('names the slot and the pillar, and asks for nothing else', () => {
    expect(captionInstruction('Wilderness candle relaunch — Launch', 'Home & Space')).toBe(
      'Write the caption for this post. It is the "Wilderness candle relaunch — Launch" slot in this month\'s plan, under the Home & Space pillar. Keep it to that subject.',
    );
  });

  it('drops the pillar clause rather than naming an empty pillar', () => {
    expect(captionInstruction('A small moment', '')).toBe(
      'Write the caption for this post. It is the "A small moment" slot in this month\'s plan. Keep it to that subject.',
    );
  });
});

describe('the sweep bound', () => {
  it('is two passes', () => {
    expect(MAX_SWEEP_ATTEMPTS).toBe(2);
  });

  it('counts up to the bound, then reports exhausted', () => {
    expect(sweepExhausted({ [SWEEP_ATTEMPTS_KEY]: 0 })).toBe(false);
    expect(sweepExhausted({ [SWEEP_ATTEMPTS_KEY]: 1 })).toBe(false);
    expect(sweepExhausted({ [SWEEP_ATTEMPTS_KEY]: 2 })).toBe(true);
    // Above the bound is still exhausted — a stale higher count must not read as "go again".
    expect(sweepExhausted({ [SWEEP_ATTEMPTS_KEY]: 7 })).toBe(true);
  });
});

describe('reading a count out of unvalidated jsonb', () => {
  it('treats absent, null and non-object as never swept', () => {
    expect(sweepAttemptsOf(undefined)).toBe(0);
    expect(sweepAttemptsOf(null)).toBe(0);
    expect(sweepAttemptsOf('2')).toBe(0);
    expect(sweepAttemptsOf({})).toBe(0);
  });

  it('treats a malformed or negative value as never swept, never as exhausted', () => {
    // The direction matters: a garbage value must cost the post a retry it could have had,
    // not deny it one it is owed.
    expect(sweepAttemptsOf({ [SWEEP_ATTEMPTS_KEY]: 'two' })).toBe(0);
    expect(sweepAttemptsOf({ [SWEEP_ATTEMPTS_KEY]: NaN })).toBe(0);
    expect(sweepAttemptsOf({ [SWEEP_ATTEMPTS_KEY]: -3 })).toBe(0);
    expect(sweepExhausted({ [SWEEP_ATTEMPTS_KEY]: 'lots' })).toBe(false);
  });

  it('truncates rather than rounding, so 1.9 passes is one pass', () => {
    expect(sweepAttemptsOf({ [SWEEP_ATTEMPTS_KEY]: 1.9 })).toBe(1);
  });
});
