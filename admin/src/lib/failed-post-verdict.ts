/**
 * failed-post-verdict.ts — "what is going to happen to this post?", for the Failed Posts list.
 *
 * The only column on that page an operator acts on. It is a pure derivation, in its own file,
 * because the one way this page can lie is by promising a retry the sweep will not make: the
 * order of the clauses here mirrors the order of the sweep's WHERE clauses exactly
 * (engine/src/content-cycles/generation-sweep.ts), and the pass count comes from the same
 * shared reader both use.
 */
import { sweepAttemptsOf, sweepExhausted, MAX_SWEEP_ATTEMPTS } from '@sprigly/engine/generation-recovery';

export type VerdictTone = 'waiting' | 'ours' | 'yours';
export interface Verdict { label: string; detail: string; tone: VerdictTone }

/**
 * @param sourceMeta    the post's source_meta jsonb (where the pass count lives)
 * @param scheduledDate the post's date, 'YYYY-MM-DD'
 * @param today         London's calendar day, 'YYYY-MM-DD'
 */
export function verdictFor(sourceMeta: unknown, scheduledDate: string, today: string): Verdict {
  const used = sweepAttemptsOf(sourceMeta);

  // Past-dated FIRST, matching the sweep: a post whose date has gone is not re-generated
  // however many passes it has left, so saying "will retry" would be false.
  if (scheduledDate < today) {
    return { label: 'Not retried', detail: 'the date has passed — no longer worth generating', tone: 'yours' };
  }
  if (sweepExhausted(sourceMeta)) {
    return { label: 'Yours', detail: `${used} of ${MAX_SWEEP_ATTEMPTS} sweep passes used — no further attempts`, tone: 'yours' };
  }
  return {
    label:  'Will retry',
    detail: used === 0 ? 'not swept yet — next tick, 05:00' : `${used} of ${MAX_SWEEP_ATTEMPTS} sweep passes used`,
    tone:   used === 0 ? 'waiting' : 'ours',
  };
}
