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
import { and, or, eq, lt, isNull, gte, inArray, sql as dsql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { contentCyclePosts } from '@sprigly/db';
import { captionInstruction, beatSubject, sweepAttemptsOf, sweepExhausted, MAX_SWEEP_ATTEMPTS, SWEEP_ATTEMPTS_KEY } from '@sprigly/engine/generation-recovery';
import { classifyGenerationFailure, QUOTA_BANKED_KEY, type GenerationFailureClass } from '@sprigly/engine/ai-change-cap';
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
 *  is not a retry.
 *
 *  `pendingInstruction` STILL WINS, and the beat's subject is deliberately not merged into it.
 *  That field is a client's own explicit reshape of THIS post ("make it softer"), and it is
 *  the whole ask; appending background to it would change what the client asked for, which is
 *  the one thing this function exists not to do. The subject enriches only the deterministic
 *  fan-out brief — the branch that had no referent for its slot title in the first place. */
export function instructionFor(post: { pillar: string | null; sourceMeta: unknown; beatMeta?: unknown }): string {
  const sm = (post.sourceMeta ?? {}) as Record<string, unknown>;
  const pending = sm['pendingInstruction'];
  if (typeof pending === 'string' && pending.trim()) return pending;
  const title = typeof sm['title'] === 'string' ? sm['title'] : '';
  return captionInstruction(title, post.pillar ?? '', beatSubject(post.beatMeta));
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
  /** How many of the considered posts were STALE 'generating' rather than 'generation_failed'
   *  (X4). Reported separately because a non-zero count is a different fault: it means a post
   *  was marked in-flight and the job never made it onto the queue. */
  stranded:    number;
  /** Cap refusals seen and deliberately left alone (X2e). They are released by
   *  `releaseBankedChanges`, not by a retry. */
  quotaHeld:   number;
  /** Failures the request itself caused. Not retried, and an operator item from the first
   *  pass rather than after two paid ones (X2e). */
  operatorItems: number;
}

/**
 * ── WHAT THIS SWEEP RETRIES, AND WHAT IT REFUSES TO (X2e) ────────────────────────────
 *
 * It used to re-enqueue every `generation_failed` post twice, whatever had gone wrong. Two of
 * the three things that go wrong cannot be fixed by trying again, and paying for the attempt is
 * the whole cost of not knowing which:
 *
 *   QUOTA          the monthly allowance is spent. A retry can only be refused again, at the
 *                  cost of a round trip, every day until the 1st. Held here and released by
 *                  `releaseBankedChanges` when the allowance actually comes back.
 *                  DETECTED by the `quotaBanked` FLAG the refusal wrote — never by its wording,
 *                  which is copy and would break the predicate the first time it improved.
 *   TRANSIENT      a timeout, a throttle, a connection, a 5xx. Genuinely worth another go, and
 *                  soon: the fast tick (`generation-retry-tick`, every 10 minutes) is the one
 *                  that actually delivers "minutes, not a day", and the daily pass is a backstop
 *                  behind it. DETECTED by an explicit marker list over the stored error.
 *   DETERMINISTIC  the request cannot be satisfied — a caption the gate will not pass, a brief
 *                  the critic keeps rejecting. It stops on the first pass and becomes an
 *                  operator item immediately (admin → Failed Posts), which is both cheaper and
 *                  sooner than the two paid passes it used to get. DETECTED by exclusion, and
 *                  that direction is deliberate: mis-classing a deterministic failure as
 *                  transient bills the same doomed call forever and surfaces nothing; the other
 *                  way round surfaces it to someone who can look.
 *
 * The STRANDED case (X4) is none of the three: there is no error at all, because nothing ever
 * ran. It is always re-enqueued, under the same spend bound.
 */

/**
 * ── THE SECOND STATUS: 'generating' WITH NOTHING WORKING ON IT (X4) ──────────────────
 *
 * The sweep's own premise is "the only state that means nothing is working on this". That was
 * `generation_failed` alone, and it left one hole.
 *
 * A post is inserted as 'generating' and THEN its job is enqueued — deliberately, because the
 * reverse would let a job run against a row that does not exist. `startPostGeneration` stamps
 * `generation_failed` if the enqueue reports an error, so the ordinary failure is covered. What
 * is not is the process DYING between the insert and the enqueue: a container restart, an OOM,
 * a deploy landing mid-request. The row then says 'generating' forever, the client reads *On its
 * way* forever, and nothing anywhere is looking for it — the exact stuck state the header of
 * this file says must not exist.
 *
 * The bound is age, not a flag. A post that has been 'generating' for longer than this has
 * outlived any honest attempt: GENERATION_JOB_OPTIONS is three tries with an exponential backoff
 * from 5s, and a Bedrock call is capped at 180s, so the worst legitimate life of a job is minutes.
 * Two hours is far past that and far short of the daily tick, so a post stranded at 06:00 is
 * picked up on the next day's pass rather than fought over with a job that is merely slow.
 *
 * `clearOrBusy` is the second guard and the load-bearing one: a job that IS on the queue —
 * waiting, active or delayed — reports busy and the post is skipped whatever its age says.
 */
export const STRANDED_GENERATING_MS = 2 * 60 * 60 * 1000;

/**
 * Daily sweep: posts whose caption generation ran out of BullMQ retries.
 *
 * Selection is narrow on purpose, and each clause is a rule:
 *
 *   status = 'generation_failed'   BullMQ has nothing left to try
 *     OR 'generating' + stale      marked in flight, but old enough that no honest job is
 *                                  still running (STRANDED_GENERATING_MS). `clearOrBusy`
 *                                  is what actually decides — this clause only narrows the
 *                                  scan. Together the two are "nothing is working on this".
 *   deleted_at IS NULL             a removed post is not work
 *   scheduled_date >= today        a post whose date has passed is not worth paying for.
 *                                  It still shows in the operator list; it is simply not
 *                                  re-generated, because the month it belonged to is gone.
 *   sweep attempts < MAX           the bound. Filtered in SQL rather than in code so the
 *                                  pass cap counts posts we might act on, and a backlog of
 *                                  exhausted posts cannot starve a fresh one.
 *
 * NOTE ON 'new'. It is deliberately NOT swept, and the reason is worth stating because the
 * status counts invite the opposite conclusion: a SUCCESSFUL generation resolves 'generating'
 * → 'new' (shape.ts), so 'new' is the finished state, not an orphan. The posts that used to
 * strand there came from the agent's bare-add path writing a placeholder and enqueuing nothing;
 * that path is gone (agent/proposals.ts), which is the fix. Sweeping 'new' would re-generate
 * every post the client has ever added, every day, forever.
 */
export async function sweepFailedGenerations(
  deps: Pick<PlanningDeps, 'db'> & { logger: Logger },
  queue: Queue,
  now: Date = new Date(),
): Promise<GenerationSweepResult> {
  const { db, logger } = deps;
  const t = getLondonToday(now);
  const today = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

  const strandedBefore = new Date(now.getTime() - STRANDED_GENERATING_MS);
  const candidates = await db
    .select({
      id: contentCyclePosts.id, clientId: contentCyclePosts.clientId, cycleId: contentCyclePosts.cycleId,
      pillar: contentCyclePosts.pillar, sourceMeta: contentCyclePosts.sourceMeta,
      status: contentCyclePosts.status,
      // Same reason as the fan-out's select (phase2.ts): a retry that rebuilds the brief
      // without the beat's own subject would re-run the exact prompt that lost it.
      beatMeta: contentCyclePosts.beatMeta,
    })
    .from(contentCyclePosts)
    .where(and(
      or(
        eq(contentCyclePosts.status, 'generation_failed'),
        and(eq(contentCyclePosts.status, 'generating'), lt(contentCyclePosts.updatedAt, strandedBefore)),
      ),
      isNull(contentCyclePosts.deletedAt),
      gte(contentCyclePosts.scheduledDate, today),
      dsql`coalesce((${contentCyclePosts.sourceMeta} ->> ${SWEEP_ATTEMPTS_KEY})::int, 0) < ${MAX_SWEEP_ATTEMPTS}`,
      // Cap refusals are excluded HERE as well as in the loop, so a client sitting on fifty
      // banked posts cannot consume the pass cap and starve a post that is genuinely stuck.
      dsql`(${contentCyclePosts.sourceMeta} ->> ${QUOTA_BANKED_KEY}) IS DISTINCT FROM 'true'`,
    ))
    .orderBy(contentCyclePosts.scheduledDate)
    .limit(SWEEP_LIMIT + 1);

  const capped = candidates.length > SWEEP_LIMIT;
  const batch  = capped ? candidates.slice(0, SWEEP_LIMIT) : candidates;
  if (capped) {
    logger.warn({ limit: SWEEP_LIMIT }, 'generation sweep: more failed posts than the pass cap — the rest wait for tomorrow');
  }

  const result: GenerationSweepResult = { considered: batch.length, reenqueued: 0, busy: 0, failed: 0, capped, stranded: 0, quotaHeld: 0, operatorItems: 0 };

  for (const post of batch) {
    const attempts = sweepAttemptsOf(post.sourceMeta);
    const stranded = post.status === 'generating';
    if (stranded) result.stranded++;
    // A stranded post has no error to classify — nothing ran. Everything else is classified.
    const failureClass: GenerationFailureClass | null = stranded ? null : classifyGenerationFailure(post.sourceMeta);
    const logCtx = { cycleId: post.cycleId, postId: post.id, attempts, stranded, failureClass };

    if (failureClass === 'quota') {
      // Belt to the WHERE clause's braces. A retry here cannot succeed and would be billed.
      result.quotaHeld++;
      logger.info(logCtx, 'generation sweep: held by the monthly change cap — waiting for the release, not retried');
      continue;
    }
    if (failureClass === 'deterministic') {
      result.operatorItems++;
      logger.warn(logCtx, 'generation sweep: the request itself failed — operator item, not retried');
      continue;
    }

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
          // read and now, we must not drag a good caption back into 'generating'. Both statuses
          // are admitted because both are selected on — a stranded post is already 'generating'
          // and this write is what bumps its attempt count and its updated_at.
          inArray(contentCyclePosts.status, ['generation_failed', 'generating']),
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
