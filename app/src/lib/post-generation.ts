/**
 * post-generation.ts — start (or retry) async caption generation for a post that
 * already occupies its calendar slot. Quota is checked here (exactly as a direct
 * rewrite) and counted when the shape job writes its post_edits row on completion.
 *
 * The post is left in a truthful state throughout: 'generating' while the job is
 * in flight, 'generation_failed' (instruction preserved) if quota is exhausted or
 * the enqueue fails — never the default placeholder.
 */
import { bankedLine } from '@sprigly/engine/ai-change-cap';
import { getUsageForCycle, isRewriteBlocked } from './usage';
import { enqueueShape, enqueueHookJob } from './queue';
import { markPostGenerating, markPostGenerationFailed, markPostBanked } from './mutations';
import { editScopeToday } from './edit-scope';
import type { PlanActor } from '@sprigly/db';

const FORMAT_WORD: Record<string, string> = { reel: 'reel', carousel: 'carousel', single: 'single image post' };

/**
 * THE BRIEF FOR AN ADD WITH NO SUBJECT — one copy, for every add path (X4).
 *
 * It says only what the client's own act said: this day, this format. No topic is invented — the
 * generator writes from the client's voice and their plan context, which is what it does for
 * every other post in the month.
 *
 * It lived in `/api/posts` alone, which is the whole of the enqueue gap: the route that had it
 * always enqueued, and the AGENT's add path, which did not, fell through to `addDraft` — a
 * placeholder caption, status 'new', and no job. Both callers read it from here now, so "an add
 * always gets a caption written" is one rule with one wording rather than a property of whichever
 * door the client happened to come through.
 */
export function defaultCaptionBrief(date: string, format: string): string {
  return `Write a caption for a ${FORMAT_WORD[format] ?? 'post'} going out on ${date}. `
    + 'No subject was given, so choose one that fits this client’s voice and the rest of the month.';
}

export type StartGenerationResult =
  | { jobId: string }
  /** `banked: true` is the CAP's own outcome, distinct from any other block: the work is stored
   *  and will run by itself on `resetsOn`. Callers that tell the client anything must say which
   *  of the two happened, because only one of them is a promise. */
  | { blocked: true; message: string; banked?: boolean; resetsOn?: string }
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
    /**
     * ── THE CAP BANKS THE WORK; IT DOES NOT LOSE IT (X2b) ────────────────────────────
     *
     * This already stored an honest sentence and kept the instruction — the post has everything
     * it needs to be written the moment the allowance comes back. What it did not do is SAY SO
     * in a form anything could act on: the row read `generation_failed`, which `isOnTheWay`
     * collapses into "On its way", so the client was told words were coming when nothing was
     * coming until the reset, and the daily sweep re-ran the refusal to be refused again.
     *
     * `markPostBanked` writes the FLAG. Everything downstream keys on it: the surface renders
     * the quiet state (`generation-state.ts`), the sweep classifies it QUOTA and never retries
     * it (`ai-change-cap.ts` → `generation-sweep.ts`), and the banked-run trigger picks it up
     * on the first tick after the reset (`banked-changes.ts`).
     */
    const message = bankedLine(usage.resetsOn);
    await markPostBanked(clientId, cycleId, postId, instruction, message);
    return { blocked: true, message, banked: true, resetsOn: usage.resetsOn };
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
