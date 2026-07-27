/**
 * script-ready.ts — enqueue a reel's combined hook+script job once its CAPTION has landed.
 *
 * A reel's hook and script are now generated together in one job (script.ts), so the only
 * precondition is the caption — the subject the pair is about. In the fan-out the caption
 * comes from the shape job; the worker checks after that completes and enqueues the combined
 * job. (Before the merge this waited on hook AND caption, because the hook was a separate job
 * that raced the caption; the combined job writes the hook itself, so the wait is gone.)
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
 * Enqueue the combined hook+script job for `postId` if — and only if — it is a reel that has
 * a caption and no script yet. The job writes the hook itself, so a pre-existing hook is not a
 * precondition; a script already present means it (and its hook) were written, so we never pay
 * twice.
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
  if (!post.caption) return false;                       // the subject has not landed yet
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
