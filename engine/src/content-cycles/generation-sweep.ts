/**
 * generation-sweep.ts — the daily retry arm for a caption that never got written.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────
 *
 * The mobile redesign removes the client's retry button (spec G4): a post still being
 * written reads as *on its way*, and nothing is asked of the client. That is only honest if
 * the system genuinely recovers by itself, and if the one it cannot recover becomes visible
 * to an operator instead. Shipping the copy without both halves strands the post — the
 * client is told to wait for something nobody is doing.
 *
 * Bounded retry already exists: GENERATION_JOB_OPTIONS is `{attempts: 3, exponential 5s}`,
 * and `generation_failed` is stamped only once BullMQ has nothing left to try
 * (consumer.ts → isFinalAttempt). What did not exist is anything AFTER that. The comment at
 * the top of plan-ready.ts was accurate: "'generation_failed' is terminal — nothing retries
 * it". This is what stops that being true, and it is deliberately the same shape as
 * `sweepUnsentPlanReady`, its sibling on the same 05:00 tick.
 *
 * ── The bound, and where the count lives ─────────────────────────────────────────────
 *
 * TWO sweep passes per post, then it stops consuming spend and becomes an operator item.
 * Each pass is up to three paid Bedrock attempts, so the ceiling is nine — enough that a
 * transient outage on the night of a fan-out self-heals by morning, and small enough that a
 * post whose brief the model genuinely cannot satisfy is not billed indefinitely.
 *
 * The count is kept in `source_meta.generationSweepAttempts`. That is the smallest honest
 * home for it:
 *
 *   - source_meta is ALREADY the per-post generation scratchpad. `pendingInstruction` and
 *     `generationError` live there, written by exactly the paths this sweep re-runs, and
 *     read by exactly the surfaces that render the outcome. The counter is the third field
 *     of the same record, not a new kind of fact.
 *   - It is per-post, transient, and meaningful only while a post is broken. A column would
 *     add a migration, a schema entry and a NOT NULL default to every row that will never
 *     use it, in order to store a number that is dead the moment the caption lands.
 *   - It survives the same way the reason does. A post that exhausts its passes carries both
 *     the count and the error, which is precisely the pair the operator list renders.
 *
 * The trade is that it is not indexable, so the "has it run out?" predicate is a jsonb cast
 * in the WHERE clause rather than a column scan. At the volumes involved — failed posts, not
 * posts — that is the cheaper side of the trade.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────────────
 *
 * Enqueue FIRST, then stamp. The reverse would leave a post reading 'generating' with
 * nothing working on it if the enqueue threw — the exact stuck state markGenerationFailed
 * exists to prevent. A failed enqueue costs nothing and does not consume a pass.
 */
import { and, eq, isNull, gte, sql as dsql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { contentCyclePosts } from '@sprigly/db';
import { captionInstruction, sweepAttemptsOf, sweepExhausted, MAX_SWEEP_ATTEMPTS, SWEEP_ATTEMPTS_KEY } from '@sprigly/engine/generation-recovery';
import type { PlanningDeps } from './planning.js';
import { GENERATION_JOB_OPTIONS } from './job-options.js';
import { getLondonToday } from './scheduler.js';

export { MAX_SWEEP_ATTEMPTS, sweepAttemptsOf, sweepExhausted };

/** Cap on one pass. A guard against an unbounded scan, not a rate limit — a capped pass
 *  says so in the log rather than reporting a clean run over a truncated list. */
const SWEEP_LIMIT = 50;

/** Mirrors app/src/lib/queue.ts — BullMQ forbids colons in custom job ids. */
export const shapeJobId = (cycleId: string, postId: string): string => `shape_${cycleId}_${postId}`;

/** The instruction to re-run with: the one the post was created from, else the deterministic
 *  fan-out instruction for its slot. Never invents a new brief — a retry that changes the ask
 *  is not a retry. */
export function instructionFor(post: { pillar: string | null; sourceMeta: unknown }): string {
  const sm = (post.sourceMeta ?? {}) as Record<string, unknown>;
  const pending = sm['pendingInstruction'];
  if (typeof pending === 'string' && pending.trim()) return pending;
  const title = typeof sm['title'] === 'string' ? sm['title'] : '';
  return captionInstruction(title, post.pillar ?? '');
}

/**
 * Clear a stale completed/failed slot so a re-enqueue is not silently deduplicated.
 *
 * BullMQ returns from `queue.add()` without error AND without enqueuing when a job of that
 * id is already in the completed set — which every post here is, because the id is
 * deterministic and the last attempt used it. An in-flight job (waiting/active/delayed) is
 * left alone and reported as busy: something is already working on this post.
 */
async function clearOrBusy(queue: Queue, jobId: string): Promise<'clear' | 'busy'> {
  const existing = await queue.getJob(jobId);
  if (!existing) return 'clear';
  const state = await existing.getState();
  if (state === 'completed' || state === 'failed' || state === 'unknown') {
    try { await existing.remove(); } catch { /* best-effort */ }
    return 'clear';
  }
  return 'busy';
}

export interface GenerationSweepResult {
  considered:  number;
  reenqueued:  number;
  busy:        number;
  failed:      number;
  capped:      boolean;
}

/**
 * Daily sweep: posts whose caption generation ran out of BullMQ retries.
 *
 * Selection is narrow on purpose, and each clause is a rule:
 *
 *   status = 'generation_failed'   the only state that means "nothing is working on this"
 *   deleted_at IS NULL             a removed post is not work
 *   scheduled_date >= today        a post whose date has passed is not worth paying for.
 *                                  It still shows in the operator list; it is simply not
 *                                  re-generated, because the month it belonged to is gone.
 *   sweep attempts < MAX           the bound. Filtered in SQL rather than in code so the
 *                                  pass cap counts posts we might act on, and a backlog of
 *                                  exhausted posts cannot starve a fresh one.
 */
export async function sweepFailedGenerations(
  deps: Pick<PlanningDeps, 'db'> & { logger: Logger },
  queue: Queue,
  now: Date = new Date(),
): Promise<GenerationSweepResult> {
  const { db, logger } = deps;
  const t = getLondonToday(now);
  const today = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

  const candidates = await db
    .select({
      id: contentCyclePosts.id, clientId: contentCyclePosts.clientId, cycleId: contentCyclePosts.cycleId,
      pillar: contentCyclePosts.pillar, sourceMeta: contentCyclePosts.sourceMeta,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.status, 'generation_failed'),
      isNull(contentCyclePosts.deletedAt),
      gte(contentCyclePosts.scheduledDate, today),
      dsql`coalesce((${contentCyclePosts.sourceMeta} ->> ${SWEEP_ATTEMPTS_KEY})::int, 0) < ${MAX_SWEEP_ATTEMPTS}`,
    ))
    .orderBy(contentCyclePosts.scheduledDate)
    .limit(SWEEP_LIMIT + 1);

  const capped = candidates.length > SWEEP_LIMIT;
  const batch  = capped ? candidates.slice(0, SWEEP_LIMIT) : candidates;
  if (capped) {
    logger.warn({ limit: SWEEP_LIMIT }, 'generation sweep: more failed posts than the pass cap — the rest wait for tomorrow');
  }

  const result: GenerationSweepResult = { considered: batch.length, reenqueued: 0, busy: 0, failed: 0, capped };

  for (const post of batch) {
    const attempts = sweepAttemptsOf(post.sourceMeta);
    const logCtx = { cycleId: post.cycleId, postId: post.id, attempts };

    // The bound again, in code. The SQL predicate above is what keeps the pass cap
    // meaningful; this is what makes the bound a property of the function rather than of one
    // WHERE clause. A spend ceiling is worth asserting twice — and it is the half a test can
    // exercise with data rather than by reading a query.
    if (sweepExhausted(post.sourceMeta)) {
      logger.info(logCtx, 'generation sweep: passes exhausted — operator item, not re-enqueued');
      continue;
    }

    try {
      const jobId = shapeJobId(post.cycleId, post.id);
      if (await clearOrBusy(queue, jobId) === 'busy') {
        result.busy++;
        logger.info(logCtx, 'generation sweep: a job for this post is already in flight — skipped');
        continue;
      }

      await queue.add('shape', {
        type: 'shape', scope: 'post',
        clientId: post.clientId, cycleId: post.cycleId, targetPostId: post.id,
        instruction: instructionFor(post), source: 'web',
        // The sweep is the system recovering its own work at 05:00 with nobody in the room.
        // Attributing it to the client would count our retry as their engagement (0090).
        actor: 'agent',
      }, { jobId, ...GENERATION_JOB_OPTIONS });

      // Stamped only after the job is genuinely on the queue. `generationError` is kept: it is
      // the reason the LAST attempt failed and stays true until a new one replaces it, and the
      // operator list reads it alongside the count.
      const meta = { ...((post.sourceMeta ?? {}) as Record<string, unknown>), [SWEEP_ATTEMPTS_KEY]: attempts + 1 };
      await db.update(contentCyclePosts)
        .set({ status: 'generating', sourceMeta: meta })
        .where(and(
          eq(contentCyclePosts.id, post.id),
          // Re-assert the state we selected on: if something resolved this post between the
          // read and now, we must not drag a good caption back into 'generating'.
          eq(contentCyclePosts.status, 'generation_failed'),
        ));

      result.reenqueued++;
      logger.info({ ...logCtx, attempts: attempts + 1, of: MAX_SWEEP_ATTEMPTS }, 'generation sweep: re-enqueued');
    } catch (err) {
      // One post's failure must not end the pass for the rest, and a failed enqueue does not
      // consume a pass — nothing was spent.
      result.failed++;
      logger.warn({ ...logCtx, err: String(err) }, 'generation sweep: could not re-enqueue (non-fatal, pass not consumed)');
    }
  }

  logger.info({ ...result }, 'generation sweep: done');
  return result;
}
