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
import { isQuotaBanked, bankedAt } from '@sprigly/engine/ai-change-cap';

export type VerdictTone = 'waiting' | 'ours' | 'yours';
export interface Verdict { label: string; detail: string; tone: VerdictTone }

/** The day a retired post was for. Its own date — the deadline that was actually missed. */
function expiredDay(_sourceMeta: unknown, scheduledDate: string): string {
  return scheduledDate;
}

/**
 * @param sourceMeta    the post's source_meta jsonb (where the pass count lives)
 * @param scheduledDate the post's date, 'YYYY-MM-DD'
 * @param today         London's calendar day, 'YYYY-MM-DD'
 */
export function verdictFor(sourceMeta: unknown, scheduledDate: string, today: string, status?: string): Verdict {
  const used = sweepAttemptsOf(sourceMeta);

  /**
   * RETIRED, and therefore finished. `banked-changes.ts` moved this row to
   * 'generation_expired' because its day passed while the allowance was spent. Nothing failed,
   * nothing is coming, and no operator action exists — the row is here so that "what did we
   * not write for this client" remains answerable, not because anybody needs to act.
   *
   * `status` is optional so existing callers keep compiling; absent means the caller only ever
   * had failure rows, which was true of every caller before the retired state existed.
   */
  if (status === 'generation_expired') {
    return {
      label:  'Not written',
      detail: `the client's allowance was spent and ${expiredDay(sourceMeta, scheduledDate)} passed before it came back — retired, nothing spent`,
      tone:   'waiting',
    };
  }

  /**
   * QUOTA REFUSALS FIRST, because they are not failures and every other clause here reads
   * them as one.
   *
   * A banked post shares the `generation_failed` status with four genuine failure paths and
   * nothing else on the row distinguishes it — which is why this page showed ivy-t's promo in
   * red under "ran out of attempts", counted in the "need you" tally, for a post that ran out
   * of nothing and needed no one. It had used zero sweep passes, because the sweep refuses to
   * touch it (generation-sweep.ts classifies quota and holds), so `used` reads 0 and the old
   * first clause fell through to whichever of date-passed or will-retry matched.
   *
   * Ordered ahead of the past-dated clause deliberately. Both are true of an expired banked
   * post, and "the date has passed" is the less useful of the two answers: it describes the
   * calendar rather than what happened. `banked-changes.ts` retires those rows to
   * 'generation_expired', so in practice they leave this list entirely — this branch is what
   * an un-retired one gets in the window before the next tick, and what a still-live banked
   * post gets for as long as it waits.
   */
  if (isQuotaBanked(sourceMeta)) {
    const since = bankedAt(sourceMeta);
    return {
      label:  'Waiting on quota',
      detail: since
        ? `the client's monthly change allowance was spent — banked ${since.slice(0, 10)}, released automatically when it refreshes`
        : "the client's monthly change allowance was spent — released automatically when it refreshes",
      // WAITING, not OURS and not YOURS. Nothing is stuck, nothing was spent, and there is
      // nothing for an operator to do: the banked-run trigger releases it by itself.
      tone:   'waiting',
    };
  }

  // Past-dated FIRST of the failure clauses, matching the sweep: a post whose date has gone is
  // not re-generated however many passes it has left, so saying "will retry" would be false.
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
