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
import { enqueueShape } from './queue';
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
