/**
 * failed-post-verdict.test.ts — the operator list tells the truth about what happens next.
 *
 * Gap 7's honesty condition runs in one direction: the client is told to wait, so somebody has
 * to be told when the waiting is over. A "Will retry" on a post the sweep has finished with is
 * the exact failure this page exists to prevent — it would look like coverage while nothing at
 * all was happening.
 */
import { describe, it, expect } from 'vitest';
import { verdictFor } from './failed-post-verdict';

const TODAY = '2026-07-28';
const FUTURE = '2026-08-04';
const PAST = '2026-07-01';

describe('a post the sweep has finished with', () => {
  it('reads as the operator’s — the list shows the exhausted post', () => {
    const v = verdictFor({ generationSweepAttempts: 2 }, FUTURE, TODAY);
    expect(v.label).toBe('Yours');
    expect(v.tone).toBe('yours');
    expect(v.detail).toContain('no further attempts');
  });

  it('says how much was spent, so the number is not a mystery', () => {
    expect(verdictFor({ generationSweepAttempts: 2 }, FUTURE, TODAY).detail).toContain('2 of 2');
  });
});

describe('a post the sweep is still working on', () => {
  it('never swept yet reads as waiting for tonight’s tick', () => {
    const v = verdictFor({}, FUTURE, TODAY);
    expect(v.label).toBe('Will retry');
    expect(v.tone).toBe('waiting');
    expect(v.detail).toContain('05:00');
  });

  it('one pass in still promises another', () => {
    const v = verdictFor({ generationSweepAttempts: 1 }, FUTURE, TODAY);
    expect(v.label).toBe('Will retry');
    expect(v.detail).toContain('1 of 2');
  });
});

describe('a post whose date has gone', () => {
  it('is the operator’s even with passes left — the sweep will not touch it', () => {
    // Past-dated is checked BEFORE the count, exactly as the sweep's WHERE clause orders it.
    // Reversing the two would print "Will retry" over a post nothing is going to pick up.
    const v = verdictFor({}, PAST, TODAY);
    expect(v.label).toBe('Not retried');
    expect(v.tone).toBe('yours');
    expect(v.detail).toContain('date has passed');
  });

  it('is still the operator’s when it also ran out of passes', () => {
    expect(verdictFor({ generationSweepAttempts: 2 }, PAST, TODAY).tone).toBe('yours');
  });

  it('today itself is not past — the sweep still generates for today', () => {
    expect(verdictFor({}, TODAY, TODAY).label).toBe('Will retry');
  });
});

describe('unreadable metadata', () => {
  it('errs towards promising the retry the post is owed, not towards writing it off', () => {
    expect(verdictFor(null, FUTURE, TODAY).label).toBe('Will retry');
    expect(verdictFor({ generationSweepAttempts: 'lots' }, FUTURE, TODAY).label).toBe('Will retry');
  });
});
