/**
 * phase2.ts — fan generation out across an approved month.
 *
 * One job per post, through the SHIPPED per-post path. Nothing here is new machinery:
 *   caption → enqueueShape  → shape.ts (assembleShapeContext → regeneratePost → gate →
 *                             critic → catalogue), which writes caption + status ONLY
 *   hook    → enqueueHookJob   → hook.ts   (reels + carousels)
 *   script  → enqueueScriptJob → script.ts (reels only, needs a hook and caption first),
 *             enqueued by the WORKER once both have landed (consumer.ts scriptReadyCheck)
 *
 * ── Structure is immutable by construction, not by care ──────────────────────
 * shape.ts writes `{ caption, status }` and nothing else, and the structural fields inside
 * the regeneration are pinned by the merge in regeneratePost (613030e). So "phase 2
 * consumes beats as fixed structure" is a property of the code path, not a discipline the
 * fan-out has to maintain. This module could not move a beat if it tried.
 *
 * ── Partial failure ──────────────────────────────────────────────────────────
 * A month is not all-or-nothing. Each post is its own job; a failure lands that ONE post in
 * 'generation_failed' with the reason on source_meta, and the surface offers a per-post
 * retry. Ten good posts and one broken one is a month the client can work with; a blocked
 * cycle is not.
 *
 * Ordering matters for reels: a script needs a hook AND a caption, and those two jobs race.
 * So scripts are not enqueued here — the worker enqueues one when the last of the pair lands
 * for a reel (consumer.ts, scriptReadyCheck). This comment previously pointed at
 * `enqueueScriptsForReady`, which was never built: in the fan-out no script was ever
 * enqueued at all (docs/reports/wrong-month-generated.md §5c).
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db, contentCyclePosts, POST_STATUS_DRAFT } from '@sprigly/db';
import { enqueueShape, enqueueHookJob } from '@/lib/queue';
import { POST_STATUS_GENERATING } from '@/lib/draft-approval';
import { recordPhase2Run, type Phase2Cost } from '@/lib/phase2-cost';

/** Hooks apply to reels and carousels (Phase 0 I-3; PostEditor.tsx:93 "product decision"). */
const HOOK_FORMATS = new Set(['reel', 'carousel']);

/** The instruction that drives caption generation for an approved beat.
 *
 *  Deliberately spare. The beat already carries its date, format and pillar, and
 *  assembleShapeContext supplies voice, catalogue and competitor context. Restating those
 *  here would give the model two sources for the same facts and a chance to disagree with
 *  itself. The one thing it needs that the row does not carry is what this slot is FOR. */
function captionInstruction(title: string, pillar: string): string {
  return `Write the caption for this post. It is the "${title}" slot in this month's plan${pillar ? `, under the ${pillar} pillar` : ''}. Keep it to that subject.`;
}

export interface Phase2Result {
  captionsQueued: number;
  hooksQueued:    number;
  failed:         Array<{ postId: string; reason: string }>;
}

/**
 * Start phase 2 for an approved cycle.
 *
 * Enqueues rather than generates: the worker owns concurrency (2, consumer.ts:233), so a
 * 30-beat month cannot stampede Bedrock however fast this loop runs. Shape/hook/script jobs
 * carry `attempts: 1` (queue.ts:87, :130, :188) — no BullMQ-level retry, because a failed
 * generation is usually a bad response rather than a flaky connection, and silently paying
 * for three identical attempts is worse than surfacing one failure the client can retry
 * deliberately.
 */
export async function startPhase2(clientId: string, cycleId: string): Promise<Phase2Result> {
  const posts = await db
    .select({
      id: contentCyclePosts.id, format: contentCyclePosts.format,
      pillar: contentCyclePosts.pillar, sourceMeta: contentCyclePosts.sourceMeta,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.status, POST_STATUS_GENERATING),
      isNull(contentCyclePosts.deletedAt),
    ))
    .orderBy(contentCyclePosts.scheduledDate);

  const result: Phase2Result = { captionsQueued: 0, hooksQueued: 0, failed: [] };

  for (const post of posts) {
    const title = typeof post.sourceMeta?.['title'] === 'string' ? (post.sourceMeta['title'] as string) : '';
    const instruction = captionInstruction(title, post.pillar ?? '');

    const shape = await enqueueShape({
      type: 'shape', scope: 'post', clientId, cycleId, targetPostId: post.id,
      instruction, source: 'web',
    });
    if ('error' in shape) {
      // An enqueue failure is a real failure for that post, and must be visible rather
      // than leaving the row stuck in 'generating' forever with nothing working on it.
      await markGenerationFailed(clientId, cycleId, post.id, `Couldn’t start: ${shape.error}`);
      result.failed.push({ postId: post.id, reason: shape.error });
      continue;
    }
    result.captionsQueued++;

    if (HOOK_FORMATS.has(post.format)) {
      // autoSelect: no human is here to choose, so the job persists its top candidate.
      // Without it the hook is generated, billed and discarded, and the script that depends
      // on it is never enqueued (docs/reports/wrong-month-generated.md §5b–5c).
      const hook = await enqueueHookJob({ type: 'hook', clientId, cycleId, targetPostId: post.id, autoSelect: true });
      // A hook failure is NOT a post failure: the caption is the post, the hook is an
      // enhancement to it. Losing a hook must not mark the post broken.
      if (!('error' in hook)) result.hooksQueued++;
    }
  }

  await recordPhase2Run({
    clientId, cycleId,
    postsTotal: posts.length,
    captionsQueued: result.captionsQueued,
    hooksQueued: result.hooksQueued,
    enqueueFailures: result.failed.length,
  });

  return result;
}

/** Stamp one post as failed, with the reason where the surface can read it. */
export async function markGenerationFailed(clientId: string, cycleId: string, postId: string, reason: string): Promise<void> {
  const [row] = await db
    .select({ sourceMeta: contentCyclePosts.sourceMeta })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.id, postId), eq(contentCyclePosts.clientId, clientId)))
    .limit(1);
  const meta = { ...((row?.sourceMeta ?? {}) as Record<string, unknown>), generationError: reason };
  await db.update(contentCyclePosts)
    .set({ status: 'generation_failed', sourceMeta: meta })
    .where(and(
      eq(contentCyclePosts.id, postId),
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.cycleId, cycleId),
      // Never resurrect a draft into a failed state — only a post already generating.
      ne(contentCyclePosts.status, POST_STATUS_DRAFT),
    ));
}

export type { Phase2Cost };
