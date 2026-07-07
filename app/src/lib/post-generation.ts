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

export type StartGenerationResult =
  | { jobId: string }
  | { blocked: true; message: string }
  | { error: string };

export async function startPostGeneration(
  clientId: string, cycleId: string, postId: string, instruction: string,
): Promise<StartGenerationResult> {
  const usage = await getUsageForCycle(clientId, cycleId);
  if (isRewriteBlocked(usage)) {
    const message = `You’ve used all ${usage.limit} AI changes this month — this post is saved, so retry after the 1st or edit it directly.`;
    await markPostGenerationFailed(clientId, cycleId, postId, message);
    return { blocked: true, message };
  }

  await markPostGenerating(clientId, cycleId, postId, instruction);
  const r = await enqueueShape({ type: 'shape', scope: 'post', clientId, cycleId, targetPostId: postId, instruction, source: 'web' });
  if ('error' in r) {
    await markPostGenerationFailed(clientId, cycleId, postId, r.error);
    return { error: r.error };
  }
  // 'busy' means a shape job for this post is already in flight — its jobId is
  // still the one to poll, so treat it as in-progress.
  return { jobId: r.jobId };
}
