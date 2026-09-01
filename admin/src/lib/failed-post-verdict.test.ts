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

describe('a quota refusal is not a failure', () => {
  /**
   * The live case. ivy-t's promo carried `quotaBanked` and zero sweep passes — zero because the
   * sweep refuses to touch a quota refusal, not because nothing had got round to it yet. So the
   * old clause order read "not swept yet" or "date has passed" over a post that ran out of
   * nothing, spent nothing, and needed nobody, and the page counted it in "need you".
   */
  const banked = { quotaBanked: true, quotaBankedAt: '2026-08-30T15:05:17.946Z', pendingInstruction: 'free uk p&P' };

  it('reads as waiting on quota, not as attempts exhausted', () => {
    const v = verdictFor(banked, FUTURE, TODAY);
    expect(v.label).toBe('Waiting on quota');
    expect(v.detail).not.toContain('sweep passes');
    expect(v.detail).not.toContain('no further attempts');
  });

  it('is NOT the operator’s — nothing is stuck and there is nothing to do', () => {
    // The tally on the page filters tone === 'yours'. This is the assertion that takes the
    // banked post out of "need you".
    expect(verdictFor(banked, FUTURE, TODAY).tone).toBe('waiting');
  });

  it('says when it was banked, so an operator can see how long the client has waited', () => {
    expect(verdictFor(banked, FUTURE, TODAY).detail).toContain('2026-08-30');
  });

  it('a banked post with no stamp still reads honestly rather than printing undefined', () => {
    const v = verdictFor({ quotaBanked: true }, FUTURE, TODAY);
    expect(v.tone).toBe('waiting');
    expect(v.detail).not.toContain('undefined');
  });

  it('the flag outranks the past-date clause — both are true, and one is more useful', () => {
    // Retirement moves these rows to 'generation_expired' on the next tick, so this is what an
    // un-retired one gets in the window between its day passing and that tick running. "The
    // date has passed" describes the calendar; "waiting on quota" describes what happened.
    const v = verdictFor(banked, PAST, TODAY);
    expect(v.label).toBe('Waiting on quota');
    expect(v.tone).toBe('waiting');
  });

  it('and a genuine failure is untouched by any of it', () => {
    // The regression guard on the new first clause: no flag, no change in behaviour.
    expect(verdictFor({ generationSweepAttempts: 2 }, FUTURE, TODAY).label).toBe('Yours');
    expect(verdictFor({}, FUTURE, TODAY).label).toBe('Will retry');
    expect(verdictFor({}, PAST, TODAY).label).toBe('Not retried');
  });
});

describe('a retired post', () => {
  it('reads as finished, not as failed — nothing was spent and nothing is coming', () => {
    const v = verdictFor({ quotaExpiredAt: '2026-09-01T05:00:00.000Z' }, PAST, TODAY, 'generation_expired');
    expect(v.label).toBe('Not written');
    expect(v.tone).toBe('waiting');
    expect(v.detail).toContain('nothing spent');
  });

  it('names the day that passed', () => {
    const v = verdictFor({}, PAST, TODAY, 'generation_expired');
    expect(v.detail).toContain(PAST);
  });

  it('the status argument is optional — existing callers keep their behaviour', () => {
    // Every caller predating the retired state passed three arguments. Those rows are failures
    // and must still be judged as failures.
    expect(verdictFor({ generationSweepAttempts: 2 }, FUTURE, TODAY).label).toBe('Yours');
  });
});
