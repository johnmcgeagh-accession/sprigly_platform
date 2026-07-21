/**
 * script-ready.ts — enqueue a reel's script once its hook AND caption have both landed.
 *
 * Why the worker owns this. A script needs both (the API route refuses without them —
 * `api/plan/script/route.ts:37`), and in the fan-out the shape and hook jobs for a post are
 * enqueued together and race. Neither one can know it was the last to finish, so neither
 * can enqueue the script on its own. The worker checks after each of them completes and
 * enqueues when the pair is complete — whichever order they arrived in.
 *
 * `phase2.ts` previously deferred this to a client-side `enqueueScriptsForReady`, which was
 * never built. The result was that no script was ever enqueued in the fan-out at all
 * (docs/reports/wrong-month-generated.md §5c).
 *
 * Idempotent by job id: `script_<cycleId>_<postId>` is deterministic, so a second call for
 * the same post is a BullMQ no-op rather than a second paid generation.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { contentCyclePosts } from '@sprigly/db';
import type { PlanningDeps } from './planning.js';
import { GENERATION_JOB_OPTIONS } from './job-options.js';

/** Matches the interactive default (PostEditor.tsx:28) — a length the client can change. */
export const DEFAULT_SCRIPT_SECONDS = 30;

export const scriptJobId = (cycleId: string, postId: string): string => `script_${cycleId}_${postId}`;

/**
 * Enqueue the script for `postId` if — and only if — it is a reel that now has both a hook
 * and a caption and no script yet.
 *
 * Returns whether a job was enqueued, so the caller can order a settlement check AFTER it:
 * settling first would declare the month ready while a script was about to be queued.
 */
export async function enqueueScriptIfReady(
  deps: Pick<PlanningDeps, 'db'> & { logger: Logger },
  queue: Queue,
  clientId: string,
  cycleId: string,
  postId: string,
): Promise<boolean> {
  const { db, logger } = deps;

  const [post] = await db
    .select({
      id: contentCyclePosts.id, format: contentCyclePosts.format,
      hook: contentCyclePosts.hook, caption: contentCyclePosts.caption,
      script: contentCyclePosts.script,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.id, postId),
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);

  if (!post) return false;
  if (post.format !== 'reel') return false;              // scripts are a reel affordance
  if (!post.hook || !post.caption) return false;         // the other half has not landed yet
  if (post.script) return false;                         // already written — never pay twice

  try {
    await queue.add(
      'script',
      { type: 'script', clientId, cycleId, targetPostId: postId, lengthSeconds: DEFAULT_SCRIPT_SECONDS },
      { jobId: scriptJobId(cycleId, postId), ...GENERATION_JOB_OPTIONS },
    );
    logger.info({ cycleId, postId }, 'script-ready: hook + caption present — enqueued script');
    return true;
  } catch (err) {
    // A script is an enhancement to a reel, not the reel. Losing one must not fail the job
    // that triggered the check, nor mark the post broken.
    logger.warn({ cycleId, postId, err: String(err) }, 'script-ready: could not enqueue script (non-fatal)');
    return false;
  }
}
