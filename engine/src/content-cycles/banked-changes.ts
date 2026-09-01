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
import { and, eq, isNull, gte, lt, asc, sql as dsql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { contentCyclePosts, contentCycles, readAiChangeUsage } from '@sprigly/db';
import { isCapReached, remainingChanges, billableForPost, expiredLine, QUOTA_BANKED_KEY, QUOTA_BANKED_AT_KEY, QUOTA_EXPIRED_AT_KEY } from '@sprigly/engine/ai-change-cap';
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
  /** Banked posts whose day passed before the allowance came back, retired this pass. Almost
   *  always 0 — a post is retired once, ever. */
  retired:    number;
}

/** One retirement pass's ceiling. Its own, NOT shared with RELEASE_LIMIT, and that separation
 *  is the point: a client sitting on a backlog of dead posts must not be able to consume the
 *  release budget and starve a post that could still be written today. */
const RETIRE_LIMIT = 200;

/**
 * ── RETIRING THE PROMISE (the other half of the date guard) ──────────────────────────
 *
 * `releaseBankedChanges` declines to write a banked post whose day has passed, and that is
 * right: paying for a caption about a day that is over buys nothing. What it did not do was
 * SAY so. The row kept `quotaBanked`, kept its message, and kept its status, so nothing ever
 * changed and the client went on reading "Waiting for your changes to refresh on 1 September"
 * in September — a date in the past, for work that would never happen. Found live on ivy-t:
 * banked 2026-08-30 for a 2026-08-31 promo, still promising on 2026-09-01.
 *
 * ── Why a SECOND query rather than widening the release one ──────────────────────────
 *
 * The release read filters these rows out in SQL, so it never sees them, and the obvious fix
 * is to drop that clause and partition in JS. Two reasons not to:
 *
 *   STARVATION. `RELEASE_LIMIT` is applied by the SQL LIMIT, before any partitioning. A
 *   client holding a backlog of expired posts would fill the pass cap with rows that cannot
 *   be written and hide the ones that can. `generation-sweep.ts` already guards the same
 *   table against exactly this, for exactly this reason.
 *
 *   SPEND. Retirement must never enqueue anything. The strongest way to guarantee that is
 *   not a comment but a signature: this function takes no `Queue`. It cannot spend money
 *   because it has nothing to spend it with.
 *
 * ── Idempotence ──────────────────────────────────────────────────────────────────────
 *
 * This runs on every tick, so "already retired" has to be a fact on the row and not an
 * assumption about ordering. `quotaExpiredAt` is that fact, and the WHERE clause requires its
 * absence. Without it the pass would rewrite the same dead rows forever — and because
 * `content_cycle_posts` carries an updated_at trigger, every rewrite would move
 * `max(updated_at)`, which is precisely what the client's surface polls on to decide
 * something changed. A retired post would announce itself as fresh news, daily.
 */
export async function retireExpiredBanked(
  deps: Pick<PlanningDeps, 'db'> & { logger: Logger },
  now: Date = new Date(),
): Promise<number> {
  const { db, logger } = deps;
  const t = getLondonToday(now);
  const today = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

  const expired = await db
    .select({
      id: contentCyclePosts.id, clientId: contentCyclePosts.clientId, cycleId: contentCyclePosts.cycleId,
      scheduledDate: contentCyclePosts.scheduledDate, sourceMeta: contentCyclePosts.sourceMeta,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.status, 'generation_failed'),
      dsql`(${contentCyclePosts.sourceMeta} ->> ${QUOTA_BANKED_KEY}) = 'true'`,
      isNull(contentCyclePosts.deletedAt),
      // The MIRROR of the release guard at the same boundary, deliberately written as its
      // complement: `lt` here, `gte` there, one `today`. Every banked post falls to exactly
      // one of the two passes, and a change to the boundary cannot move one without the other.
      lt(contentCyclePosts.scheduledDate, today),
      // Not already retired. See the idempotence note above.
      dsql`(${contentCyclePosts.sourceMeta} ->> ${QUOTA_EXPIRED_AT_KEY}) IS NULL`,
    ))
    .orderBy(asc(contentCyclePosts.scheduledDate))
    .limit(RETIRE_LIMIT);

  if (!expired.length) return 0;

  let retired = 0;
  for (const post of expired) {
    try {
      /**
       * The flag GOES and the status MOVES, and neither alone is enough.
       *
       * Clearing the flag on its own would leave the row at 'generation_failed', which
       * `isOnTheWay` collapses into "On its way" — replacing an expired promise with a live
       * one, which is worse. Moving the status on its own would leave the stored September
       * sentence in place, and the surface prefers the stored message over any constant.
       * `pendingInstruction` is deliberately KEPT: it is the record of what she asked for,
       * and an operator answering "what did we not write for her" needs it.
       */
      const meta = { ...((post.sourceMeta ?? {}) as Record<string, unknown>) };
      delete meta[QUOTA_BANKED_KEY];
      delete meta[QUOTA_BANKED_AT_KEY];
      meta['generationError'] = expiredLine(post.scheduledDate);
      meta[QUOTA_EXPIRED_AT_KEY] = now.toISOString();

      await db.update(contentCyclePosts)
        .set({ status: 'generation_expired', sourceMeta: meta })
        .where(and(
          eq(contentCyclePosts.id, post.id),
          // Re-assert what we selected on, so a post released or resolved between the read and
          // now is not dragged into a dead state behind a caption that just landed.
          eq(contentCyclePosts.status, 'generation_failed'),
        ));

      retired++;
      logger.info(
        { clientId: post.clientId, cycleId: post.cycleId, postId: post.id, scheduledDate: post.scheduledDate },
        'banked release: the day passed before the allowance came back — promise retired, nothing generated',
      );
    } catch (err) {
      // One row must not end the pass. An un-retired post is exactly where it was, still
      // showing a stale promise, and the next tick tries again.
      logger.warn(
        { clientId: post.clientId, cycleId: post.cycleId, postId: post.id, err: String(err) },
        'banked release: could not retire an expired banked post (non-fatal)',
      );
    }
  }
  return retired;
}

export async function releaseBankedChanges(
  deps: Pick<PlanningDeps, 'db'> & { logger: Logger },
  queue: Queue,
  now: Date = new Date(),
): Promise<BankedReleaseResult> {
  const { db, logger } = deps;
  const t = getLondonToday(now);
  const today = `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;

  /**
   * Retire first, release second. The order is not arithmetic — the two sets are disjoint by
   * their date clauses — but it is the honest reading order: settle what can no longer happen
   * before spending the allowance on what still can. It also means a pass that throws while
   * releasing has already told the truth about the dead ones.
   *
   * Best-effort, on the same terms the tick applies to this whole arm: a retirement that fails
   * must not cost a client their release.
   */
  let retired = 0;
  try { retired = await retireExpiredBanked(deps, now); }
  catch (err) { logger.warn({ err: String(err) }, 'banked release: retirement pass failed (non-fatal)'); }

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

  const result: BankedReleaseResult = { considered: batch.length, released: 0, stillHeld: 0, failed: 0, capped, retired };
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
        /**
         * And so does the money (0094). Banking only ever happens on the client-ask path
         * (`startPostGeneration` → `markPostBanked`), so in practice this is always true —
         * but it is DERIVED from the post rather than written as a literal, and deliberately
         * through the same helper the sweep uses. Two re-enqueuers reading one post's
         * billability must not be able to reach two answers about the same client's money.
         */
        billable: billableForPost(post.sourceMeta),
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
