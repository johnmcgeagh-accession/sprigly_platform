/**
 * post-generation.ts — start (or retry) async caption generation for a post that
 * already occupies its calendar slot. Quota is checked here (exactly as a direct
 * rewrite) and counted when the shape job writes its post_edits row on completion.
 *
 * The post is left in a truthful state throughout: 'generating' while the job is
 * in flight, 'generation_failed' (instruction preserved) if quota is exhausted or
 * the enqueue fails — never the default placeholder.
 */
import { getUsageForCycle, isRewriteBlocked } from './usage';
import { enqueueShape, enqueueHookJob } from './queue';
import { markPostGenerating, markPostGenerationFailed } from './mutations';
import { editScopeToday } from './edit-scope';
import type { PlanActor } from '@sprigly/db';

export type StartGenerationResult =
  | { jobId: string }
  | { blocked: true; message: string }
  | { error: string }
  | { readOnly: true };

/**
 * @param actor whose intent the generation carries (0090). Both call sites are client-caused —
 *              a session's own request, and an agent proposal a client approved — so 'client'
 *              is the default rather than a shrug. A future autonomous caller must pass 'agent'
 *              explicitly, which is the right way round: attributing an unknown write to the
 *              client is the error that inflates the untouched-post rate.
 */
export async function startPostGeneration(
  clientId: string, cycleId: string, postId: string, instruction: string, today: string = editScopeToday(),
  actor: PlanActor = 'client',
): Promise<StartGenerationResult> {
  const usage = await getUsageForCycle(clientId, cycleId);
  if (isRewriteBlocked(usage)) {
    const message = `You’ve used all ${usage.limit} AI changes this month. This post is saved, so it’ll wait until the 1st — or you can edit it directly.`;
    await markPostGenerationFailed(clientId, cycleId, postId, message);
    return { blocked: true, message };
  }

  // DATE POLICY: markPostGenerating refuses a past-dated post (null) — surface that.
  if (!(await markPostGenerating(clientId, cycleId, postId, instruction, today))) return { readOnly: true };
  const r = await enqueueShape({ type: 'shape', scope: 'post', clientId, cycleId, targetPostId: postId, instruction, source: 'web', actor });
  if ('error' in r) {
    await markPostGenerationFailed(clientId, cycleId, postId, r.error);
    return { error: r.error };
  }
  // 'busy' means a shape job for this post is already in flight — its jobId is
  // still the one to poll, so treat it as in-progress.
  return { jobId: r.jobId };
}

/**
 * THE FULL GENERATION for an added post (F5): what else its format is owed, beyond the caption.
 *
 * The phase-2 fan-out gives every hook-eligible post its hook and every reel its script; a post
 * added AFTER the fan-out got its caption and nothing else — the machinery existed and the add
 * path never called it. The split by format mirrors phase2.ts exactly:
 *
 *   reel      NOTHING here, deliberately. A reel's hook and script are ONE combined job
 *             (script.ts) whose input is the caption — which has not been written yet at add
 *             time. The worker enqueues it the moment the caption lands
 *             (consumer.ts → enqueueScriptIfReady), for every shape job on any path, so the
 *             added reel is already in that chain. Enqueuing it here would race the caption
 *             and burn its retries against a row that isn't ready.
 *   carousel  the standalone hook job, autoSelect — no human is mid-flow to pick a candidate,
 *             which is the same reasoning as the fan-out's (phase2.ts). This was the real hole:
 *             no path enqueued an added carousel's hook at all.
 *   single    hooks don't apply. Nothing.
 *
 * Best-effort by design: a hook is an enhancement to the post, not the post — a failure here
 * must never fail the add that triggered it (the same rule phase2 records).
 */
export async function enqueueFollowOnGeneration(
  clientId: string, cycleId: string, postId: string, format: string,
): Promise<void> {
  if (format !== 'carousel') return;
  try { await enqueueHookJob({ type: 'hook', clientId, cycleId, targetPostId: postId, autoSelect: true }); }
  catch { /* enhancement, not the post */ }
}
