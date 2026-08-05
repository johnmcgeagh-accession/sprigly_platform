/**
 * generation-recovery.test.ts — the shared facts behind "on its way" (spec gap 7).
 *
 * Three consumers read these: the fan-out enqueues with the instruction, the worker's daily
 * sweep enforces the bound, and admin's failed-posts list renders it. Pinning them here is
 * what stops the three drifting into disagreement about how many goes a post gets.
 */
import { describe, it, expect } from 'vitest';
import { captionInstruction, beatSubject, sweepAttemptsOf, sweepExhausted, MAX_SWEEP_ATTEMPTS, SWEEP_ATTEMPTS_KEY } from './generation-recovery.js';

/** ivy-t's September, verbatim — the two sentences the observed failure was written without. */
const MOLLY = 'In September we\'re launching Molly on the 18th September we need a launch post and 2 teasers on the lead up';
const REELS = 'can we do more reels this month';
const meta = (basis: string, reason?: string) => ({ slotType: 'proven', rationaleEvidence: { basis, ...(reason ? { reason } : {}) } });

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

  it('is unchanged when the beat carries no subject — the 19 observed beats of a month', () => {
    expect(captionInstruction('How Ivy began', 'Origin', null)).toBe(captionInstruction('How Ivy began', 'Origin'));
  });

  it('carries the client\'s own sentence, framed as background rather than as a brief', () => {
    const out = captionInstruction('Molly — Launch', 'Product', MOLLY);
    // The slot brief is intact and still first: the subject ADDS to it, never replaces it.
    expect(out.startsWith('Write the caption for this post. It is the "Molly — Launch" slot')).toBe(true);
    expect(out).toContain(`"${MOLLY}"`);
    // The three load-bearing clauses. Reworded freely; deleted, this is the Karen bug again.
    expect(out).toContain('That is the SUBJECT');
    expect(out).toContain('That arrangement is ALREADY DONE');
    expect(out).toContain('The schedule is never the subject');
  });

  it('does not tell the model to disregard a block shape.ts will wrap in "honour it"', () => {
    // The wrapper is `The client asked for this change: "…". Rewrite the caption to honour it`.
    // A subject block that disclaims itself ("not a brief to carry out") contradicts it, and a
    // contradiction the model must resolve is one it can resolve the wrong way. It reconciles
    // instead: honouring the instruction IS writing this post's share.
    const out = captionInstruction('Molly — Launch', 'Product', MOLLY);
    expect(out).not.toMatch(/not (a brief|an instruction) to (carry out|follow)/i);
    expect(out).toContain("honour it by writing THIS post's share");
  });
});

describe('beatSubject — which reasons are a SUBJECT', () => {
  it('reads the sentence off a beat a client instruction placed', () => {
    expect(beatSubject(meta('client_input', MOLLY))).toBe(MOLLY);
  });

  it('REFUSES emphasis_reweight — a planning preference is not what a post is about', () => {
    // The placement already honoured "more reels". Briefing a caption with it would have
    // told three of September's beats that their subject was the month's format mix.
    expect(beatSubject(meta('emphasis_reweight', REELS))).toBeNull();
  });

  it('refuses every other basis, with or without a reason', () => {
    for (const basis of ['observed', 'template', 'client_added']) {
      expect(beatSubject(meta(basis))).toBeNull();
      expect(beatSubject(meta(basis, 'something'))).toBeNull();
    }
  });

  it('reads malformed jsonb as "no subject" rather than throwing on the fan-out path', () => {
    for (const bad of [null, undefined, 'string', 42, {}, { rationaleEvidence: null }, { rationaleEvidence: 'x' }]) {
      expect(beatSubject(bad)).toBeNull();
    }
    expect(beatSubject(meta('client_input', '   '))).toBeNull();
  });

  it('collapses the whitespace a typed brief arrives with', () => {
    expect(beatSubject(meta('client_input', '  launching   Molly\n\non the 18th '))).toBe('launching Molly on the 18th');
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
