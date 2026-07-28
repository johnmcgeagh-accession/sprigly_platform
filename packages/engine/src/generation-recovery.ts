/**
 * generation-recovery.ts — what the system does about a caption that never got written.
 *
 * Spec gap 7. The mobile redesign removes the client's retry affordance, which is only
 * honest if the system recovers by itself and an operator sees what it cannot. That makes
 * three facts shared property rather than one module's business:
 *
 *   - the INSTRUCTION a re-generation runs with — the fan-out (app) and the sweep (worker)
 *     enqueue the same job, and two copies of a prompt is two prompts;
 *   - the BOUND on how many passes a post gets — the sweep enforces it, and the admin
 *     surface renders "will retry" vs "operator item" from the same number;
 *   - how to READ that count off a post, defensively, from jsonb nobody validates.
 *
 * All three live here so app, worker and admin cannot disagree about them. Pure — no db, no
 * queue, no React.
 */

/** The caption instruction for a planned slot. `title` and `pillar` may be empty.
 *
 *  Deliberately spare. The beat already carries its date, format and pillar, and
 *  assembleShapeContext supplies voice, catalogue and competitor context. Restating those
 *  here would give the model two sources for the same facts and a chance to disagree with
 *  itself. The one thing it needs that the row does not carry is what this slot is FOR. */
export function captionInstruction(title: string, pillar: string): string {
  return `Write the caption for this post. It is the "${title}" slot in this month's plan${pillar ? `, under the ${pillar} pillar` : ''}. Keep it to that subject.`;
}

/**
 * Passes the daily sweep will spend on one post before it becomes an operator item.
 *
 * Each pass is up to three paid Bedrock attempts (GENERATION_JOB_OPTIONS), so the ceiling is
 * nine — enough that an outage on the night of a fan-out self-heals by morning, and small
 * enough that a post whose brief the model genuinely cannot satisfy is not billed forever.
 */
export const MAX_SWEEP_ATTEMPTS = 2;

/** The source_meta key the count lives under. Named once so a typo cannot silently reset it. */
export const SWEEP_ATTEMPTS_KEY = 'generationSweepAttempts';

/** Read the sweep count off a post's source_meta. Absent, malformed or negative reads as 0. */
export function sweepAttemptsOf(sourceMeta: unknown): number {
  if (!sourceMeta || typeof sourceMeta !== 'object') return 0;
  const v = (sourceMeta as Record<string, unknown>)[SWEEP_ATTEMPTS_KEY];
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}

/** Has this post used every pass it is going to get? The predicate the sweep stops on and
 *  the admin list renders as "no further attempts — yours". */
export function sweepExhausted(sourceMeta: unknown): boolean {
  return sweepAttemptsOf(sourceMeta) >= MAX_SWEEP_ATTEMPTS;
}
