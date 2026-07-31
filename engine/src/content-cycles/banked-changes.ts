/**
 * banked-changes.ts — THE BANKED-RUN TRIGGER (X2b).
 *
 * ── What is banked, and why it needs a trigger at all ────────────────────────────────
 *
 * When the monthly AI-change allowance is spent, a post the client asked for is not lost: the
 * row is created, the instruction is kept on `source_meta.pendingInstruction`, and the refusal
 * writes a `quotaBanked` flag with an honest message naming the reset date
 * (`app/src/lib/post-generation.ts` → `markPostBanked`).
 *
 * That is a promise, and until now nothing kept it. The failed-generation sweep re-ran the
 * refusal to have it refused again; the reset itself is a date arriving, not an event anybody
 * subscribes to; and the client had been told a specific thing would happen on a specific day.
 * This is what makes it happen.
 *
 * ── Where the trigger lives, and why here rather than "on the 1st" ───────────────────
 *
 * On the SCHEDULER TICK, alongside the failed-generation sweep — both the daily 05:00 pass and
 * the fast `generation-retry-tick`. Not a date check for the 1st, and that is the load-bearing
 * choice: the allowance also comes back when an operator raises `ai_change_limit` or sets an
 * `ai_change_limit_override_until`, and a client whose plan is upgraded mid-month should have
 * their banked posts written that afternoon rather than in three weeks. So the trigger is
 * "there is allowance and there is banked work", checked often, rather than "it is the 1st".
 *
 * It costs one narrow indexed read per tick that almost always returns nothing.
 *
 * ── Spending the allowance carefully ─────────────────────────────────────────────────
 *
 * The allowance is read ONCE per (client, channel) and then spent down in memory as posts are
 * released, because `post_edits` is written by the WORKER when a job completes — so re-reading
 * after each enqueue would return the same number and this loop would release fifty posts into
 * a budget of three. Releasing is enqueuing, and the count only moves later.
 *
 * The oldest banked post goes first (by the instant it was banked, then by date), so the client
 * gets back what they asked for in the order they asked for it.
 */
import { and, eq, isNull, gte, asc, sql as dsql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { contentCyclePosts, contentCycles, readAiChangeUsage } from '@sprigly/db';
import { isCapReached, remainingChanges, QUOTA_BANKED_KEY, QUOTA_BANKED_AT_KEY } from '@sprigly/engine/ai-change-cap';
import type { PlanningDeps } from './planning.js';
import { GENERATION_JOB_OPTIONS } from './job-options.js';
import { getLondonToday } from './scheduler.js';
import { instructionFor, shapeJobId } from './generation-sweep.js';

/** One pass's ceiling. A guard against an unbounded scan, not a rate limit — the allowance is
 *  the real limit, and a capped pass says so in the log. */
const RELEASE_LIMIT = 100;

export interface BankedReleaseResult {
  considered: number;
  released:   number;
  /** Still banked because the allowance ran out again while releasing. They stay banked and
   *  their message stays true; the next tick tries again. */
  stillHeld:  number;
  failed:     number;
  capped:     boolean;
}

export async function releaseBankedChanges(
  deps: Pick<PlanningDeps, 'db'> & { logger: Logger },
  queue: Queue,
  now: Date = new Date(),
): Promise<BankedReleaseResult> {
  const { db, logger } = deps;
  const t = getLondonToday(now);
  const today = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

  const banked = await db
    .select({
      id: contentCyclePosts.id, clientId: contentCyclePosts.clientId, cycleId: contentCyclePosts.cycleId,
      pillar: contentCyclePosts.pillar, sourceMeta: contentCyclePosts.sourceMeta,
      channel: contentCycles.channel,
    })
    .from(contentCyclePosts)
    .innerJoin(contentCycles, eq(contentCyclePosts.cycleId, contentCycles.id))
    .where(and(
      eq(contentCyclePosts.status, 'generation_failed'),
      dsql`(${contentCyclePosts.sourceMeta} ->> ${QUOTA_BANKED_KEY}) = 'true'`,
      isNull(contentCyclePosts.deletedAt),
      // A banked post whose date has passed is not worth paying for. It stays banked and
      // visible; it is simply not written, because the day it was for has gone.
      gte(contentCyclePosts.scheduledDate, today),
    ))
    // Oldest banked first, then by the day it is for: what they asked for first is written first.
    .orderBy(asc(dsql`${contentCyclePosts.sourceMeta} ->> ${QUOTA_BANKED_AT_KEY}`), asc(contentCyclePosts.scheduledDate))
    .limit(RELEASE_LIMIT + 1);

  const capped = banked.length > RELEASE_LIMIT;
  const batch  = capped ? banked.slice(0, RELEASE_LIMIT) : banked;
  if (capped) logger.warn({ limit: RELEASE_LIMIT }, 'banked release: more banked posts than the pass cap — the rest wait for the next tick');

  const result: BankedReleaseResult = { considered: batch.length, released: 0, stillHeld: 0, failed: 0, capped };
  if (!batch.length) return result;

  /** Allowance per (client, channel), read once and spent down in memory. See the header. */
  const budgets = new Map<string, number>();

  for (const post of batch) {
    const key = `${post.clientId}:${post.channel}`;
    const logCtx = { clientId: post.clientId, cycleId: post.cycleId, postId: post.id };

    try {
      if (!budgets.has(key)) {
        const usage = await readAiChangeUsage(db, post.clientId, post.channel, now);
        budgets.set(key, isCapReached(usage, now) ? 0 : remainingChanges(usage, now));
      }
      const budget = budgets.get(key)!;
      if (budget <= 0) {
        result.stillHeld++;
        continue;   // no allowance yet — the post stays banked and its message stays true
      }

      // Enqueue FIRST, then clear the flag — the ordering the sweep records, for the same
      // reason: a post that reads 'generating' with nothing behind it is the stuck state.
      const jobId = shapeJobId(post.cycleId, post.id);
      const existing = await queue.getJob(jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === 'completed' || state === 'failed' || state === 'unknown') {
          try { await existing.remove(); } catch { /* best-effort */ }
        } else {
          // Something is already working on it; leave the flag for the next pass to settle.
          continue;
        }
      }

      await queue.add('shape', {
        type: 'shape', scope: 'post',
        clientId: post.clientId, cycleId: post.cycleId, targetPostId: post.id,
        instruction: instructionFor(post), source: 'web',
        // The client asked for this — weeks ago, and we are only now able to do it. The
        // attribution belongs to the ask, not to the tick that finally ran it (0090).
        actor: 'client',
      }, { jobId, ...GENERATION_JOB_OPTIONS });

      // The flag goes and the message with it: the post is genuinely on its way now, and the
      // surface's banked state keys on exactly this flag.
      const meta = { ...((post.sourceMeta ?? {}) as Record<string, unknown>) };
      delete meta[QUOTA_BANKED_KEY];
      delete meta[QUOTA_BANKED_AT_KEY];
      delete meta['generationError'];
      await db.update(contentCyclePosts)
        .set({ status: 'generating', sourceMeta: meta })
        .where(and(
          eq(contentCyclePosts.id, post.id),
          // Re-assert what we selected on, so a post resolved between the read and now is not
          // dragged backwards.
          eq(contentCyclePosts.status, 'generation_failed'),
        ));

      budgets.set(key, budget - 1);
      result.released++;
      logger.info({ ...logCtx, remaining: budget - 1 }, 'banked release: the allowance came back — enqueued');
    } catch (err) {
      // One post must not end the pass, and a failed enqueue changes nothing: the post is
      // still banked, still says so, and the next tick tries again.
      result.failed++;
      logger.warn({ ...logCtx, err: String(err) }, 'banked release: could not enqueue (non-fatal, still banked)');
    }
  }

  logger.info({ ...result }, 'banked release: done');
  return result;
}
