/**
 * generation-status.ts — is a cycle's generation run still writing, and when did it last write?
 *
 * ── Why this is in @sprigly/db ───────────────────────────────────────────────────────
 *
 * Two processes need "is this cycle still working" and they are in different packages. The
 * WORKER asks after every generation job, to decide whether to send the plan-ready email
 * (`engine/.../plan-ready.ts`). The APP asks while a client watches the month fill in. Same
 * question, and it decides both whether the client is emailed and whether their screen is
 * telling them the truth — so it gets one implementation, for the same reason
 * `ai-change-usage.ts` and `retire-draft-posts.ts` are here.
 *
 * ── The two halves, and which consumer needs which ───────────────────────────────────
 *
 * `plan-ready.ts` established the predicate and the reasoning behind it, which is worth
 * restating because the obvious version is wrong: shape.ts moves a post 'generating' → 'new',
 * but hook.ts and script.ts write their own fields and NEVER touch status. So the moment every
 * caption lands, every post reads 'new' while hook and reel-script jobs are still queued. A
 * status-only predicate fires early.
 *
 * The worker settles that with a second half — no pending shape/hook/script job on the queue —
 * which needs Redis. `hasGeneratingPosts` below is the DB half, moved here so both callers
 * share it rather than keeping two copies of one COUNT.
 *
 * The APP deliberately does NOT use the queue half. `hasPendingGenerationJobs` calls
 * `queue.getJobs()` across five states and filters in JS: correct, and cheap enough once per
 * job completion, but not at a poll every 1.6s per watching client. It gets the same coverage
 * from the database instead — see below.
 *
 * ── Why `lastWritten` is enough to see hooks and scripts ─────────────────────────────
 *
 * `content_cycle_posts` carries a BEFORE UPDATE trigger (`content_cycle_posts_set_updated_at`),
 * so every write to a post bumps `updated_at` whether or not the writer mentions it. A hook or
 * a script landing therefore moves `max(updated_at)` even though it moves no status. A watcher
 * that refetches whenever `lastWritten` advances sees exactly what a watcher polling the queue
 * would have seen, without asking Redis.
 *
 * That also gives the STOP condition its terminal behaviour. "Everything has a caption" is not
 * reachable — a declined launch beat settles as 'new' with no caption (phase2.ts), and a
 * 'generation_failed' post is terminal and never retried — so the client-side rule is
 * `generating === 0` AND `lastWritten` unchanged across consecutive polls. Quiet is the signal,
 * not completeness, which means a month that will never be whole still terminates.
 */
import { and, eq, isNull, sql as dsql } from 'drizzle-orm';
import { db as _db, contentCyclePosts } from './index.js';

type Executor = typeof _db | Parameters<Parameters<(typeof _db)['transaction']>[0]>[0];

export interface GenerationStatus {
  /** Live posts still in 'generating' — the DB half of the settle predicate. */
  generating: number;
  /** Live posts on the cycle, so a caller can say "6 of 28" without a second read. */
  total: number;
  /**
   * The most recent write to ANY live post on the cycle, ISO, or null when the cycle has none.
   *
   * Maintained by the table's own updated_at trigger, so it moves for a caption, a hook, a
   * script, a status flip or a client edit alike. A watcher compares it against the value it
   * last saw: advanced means something changed and the plan is worth refetching; unchanged
   * twice running, with nothing generating, means the run has gone quiet.
   */
  lastWritten: string | null;
}

/**
 * The DB half of the settle predicate: is any live post still being written?
 *
 * Soft-deleted posts are not work in flight — a tombstoned beat has no job coming for it, and
 * counting one would hold a cycle unsettled forever.
 */
export async function hasGeneratingPosts(exec: Executor, cycleId: string): Promise<boolean> {
  const [row] = await exec
    .select({ n: dsql<number>`count(*)::int` })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.status, 'generating'),
      isNull(contentCyclePosts.deletedAt),
    ));
  return (row?.n ?? 0) > 0;
}

/**
 * Everything a watcher needs, in ONE aggregate over one index scan (~0.2ms on a real month,
 * against ~59kB and seven queries for the whole plan). The cost is why this exists as its own
 * read rather than the client re-polling /api/plan.
 */
export async function readGenerationStatus(exec: Executor, cycleId: string): Promise<GenerationStatus> {
  const [row] = await exec
    .select({
      generating:  dsql<number>`count(*) FILTER (WHERE ${contentCyclePosts.status} = 'generating')::int`,
      total:       dsql<number>`count(*)::int`,
      lastWritten: dsql<Date | null>`max(${contentCyclePosts.updatedAt})`,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      isNull(contentCyclePosts.deletedAt),
    ));

  return {
    generating:  row?.generating ?? 0,
    total:       row?.total ?? 0,
    lastWritten: row?.lastWritten ? new Date(row.lastWritten).toISOString() : null,
  };
}
