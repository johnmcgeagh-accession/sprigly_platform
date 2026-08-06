/**
 * phase2.ts — fan generation out across an approved month.
 *
 * One job per post, through the SHIPPED per-post path. Nothing here is new machinery:
 *   caption → enqueueShape  → shape.ts (assembleShapeContext → regeneratePost → gate →
 *                             critic → catalogue), which writes caption + status ONLY
 *   hook    → enqueueHookJob   → hook.ts   (CAROUSELS only — reels get their hook from the
 *                             combined script job below)
 *   script  → script.ts (reels only) writes hook AND script together, enqueued by the WORKER
 *             once the CAPTION lands (consumer.ts → enqueueScriptIfReady)
 *
 * ── Structure is immutable by construction, not by care ──────────────────────
 * shape.ts writes `{ caption, status }` and nothing else, and the structural fields inside
 * the regeneration are pinned by the merge in regeneratePost (613030e). So "phase 2
 * consumes beats as fixed structure" is a property of the code path, not a discipline the
 * fan-out has to maintain. This module could not move a beat if it tried.
 *
 * ── Partial failure ──────────────────────────────────────────────────────────
 * A month is not all-or-nothing. Each post is its own job; a failure lands that ONE post in
 * 'generation_failed' with the reason on source_meta. Ten good posts and one broken one is a
 * month the client can work with; a blocked cycle is not.
 *
 * The CLIENT-facing half of that changed with gap 7: there is no per-post retry button any
 * more. The daily sweep re-enqueues a failed post twice (generation-sweep.ts), and one it
 * cannot recover surfaces in admin instead. The client reads "on its way" throughout.
 *
 * Ordering matters for reels: the combined hook+script job needs the caption. So scripts are
 * not enqueued here — the worker enqueues one when a reel's caption lands (consumer.ts →
 * enqueueScriptIfReady). This comment previously pointed at `enqueueScriptsForReady`, which was
 * never built: in the fan-out no script was ever enqueued at all
 * (docs/reports/wrong-month-generated.md §5c).
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db, contentCycles, contentCyclePosts, POST_STATUS_DRAFT } from '@sprigly/db';
import {
  captionInstruction, beatSubject, ungroundedLaunch,
  UNGROUNDED_KEY, UNGROUNDED_SUBJECT_KEY,
} from '@sprigly/engine/generation-recovery';
import { loadProductNames } from '@/lib/agent/catalogue';
import { enqueueShape, enqueueHookJob } from '@/lib/queue';
import { POST_STATUS_GENERATING } from '@/lib/draft-approval';
import { recordPhase2Run, type Phase2Cost } from '@/lib/phase2-cost';

/**
 * Which formats get a STANDALONE hook job in the fan-out.
 *
 * Carousels only. A reel's hook is now written by its combined hook+script job (script.ts),
 * enqueued by the worker once the caption lands (script-ready.ts) — so a reel that also got a
 * standalone hook job would have its hook written twice, incoherently. Carousels have no script
 * to cohere with, so they keep the standalone hook. (The interactive hook picker still offers
 * candidates for either format — this is only about the automatic fan-out.)
 */
const HOOK_FORMATS = new Set(['carousel']);

// captionInstruction moved to @sprigly/engine. The failed-generation sweep (gap 7) runs in
// the WORKER and re-enqueues the same job, so the instruction has callers on both sides of
// the app/worker boundary — and two copies of a prompt is two prompts.

export interface Phase2Result {
  captionsQueued: number;
  hooksQueued:    number;
  failed:         Array<{ postId: string; reason: string }>;
  /** Launch beats not sent to be written because their product is in no catalogue. NOT a
   *  failure: nothing went wrong, and the client has a question waiting they can answer. */
  declined:       number;
}

/**
 * Start phase 2 for an approved cycle.
 *
 * Enqueues rather than generates: the worker owns concurrency (2, consumer.ts:233), so a
 * 30-beat month cannot stampede Bedrock however fast this loop runs. Shape/hook/script jobs
 * carry GENERATION_JOB_OPTIONS — three attempts, exponential from 5s — and beyond those, two
 * passes of the daily sweep. Nine paid attempts is the ceiling for one caption.
 */
export async function startPhase2(clientId: string, cycleId: string): Promise<Phase2Result> {
  const posts = await db
    .select({
      id: contentCyclePosts.id, format: contentCyclePosts.format,
      pillar: contentCyclePosts.pillar, sourceMeta: contentCyclePosts.sourceMeta,
      // The beat's own evidence. `beatSubject` reads the client's sentence off it for the
      // beats a client instruction PLACED — without this column the fan-out brief is a slot
      // title with no referent, which is how a "Molly — Launch" caption introduced Karen.
      beatMeta: contentCyclePosts.beatMeta,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.status, POST_STATUS_GENERATING),
      isNull(contentCyclePosts.deletedAt),
    ))
    .orderBy(contentCyclePosts.scheduledDate);

  const result: Phase2Result = { captionsQueued: 0, hooksQueued: 0, failed: [], declined: 0 };

  /**
   * ── THE ONE BEAT THAT CANNOT BE WRITTEN HONESTLY ──────────────────────────────────
   *
   * A launch post whose product is in no catalogue. Its whole job is to name the thing
   * launching, and NOTHING downstream can tell that the name is fiction — the code gate has no
   * product logic, the critic is never handed the catalogue, and `validateText` returns [] the
   * moment no known name is hit. Left to run, "Molly — Launch" is billed for, passes every
   * check, and ships a confident paragraph about a product nobody can confirm exists. It is
   * caught here, before the spend, or it is not caught.
   *
   * The FULL name set, not `indexCatalogue`'s — see `loadProductNames` for why an absence check
   * cannot reuse a presence check's exclusions. Read ONCE for the month: 30 beats must not be
   * 30 catalogue reads, and an empty set (no catalogue, or a failed read) declines nothing.
   */
  const [cycleRow] = await db
    .select({ channel: contentCycles.channel })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
    .limit(1);
  const catalogueNames = cycleRow ? await loadProductNames(clientId, cycleRow.channel) : new Set<string>();

  for (const post of posts) {
    const title = typeof post.sourceMeta?.['title'] === 'string' ? (post.sourceMeta['title'] as string) : '';

    // DECLINE BEFORE THE SPEND. Deterministic, no Bedrock call, and it does not stop the month's
    // other beats: the loop continues, `plan-ready` settles on anything that is not 'generating'
    // (its own docblock: "a month with one broken caption is still a month the client should be
    // told about"), and the client is left with a question they can answer rather than a caption
    // that overreaches.
    const ungrounded = ungroundedLaunch({ title, beatMeta: post.beatMeta }, catalogueNames);
    if (ungrounded) {
      await markSubjectUngrounded(clientId, cycleId, post.id, ungrounded);
      result.declined++;
      continue;
    }

    const instruction = captionInstruction(title, post.pillar ?? '', beatSubject(post.beatMeta));

    const shape = await enqueueShape({
      type: 'shape', scope: 'post', clientId, cycleId, targetPostId: post.id,
      instruction, source: 'web',
      // Approving a draft is one act about the MONTH. It is not the client writing ten
      // captions, so the fan-out's own writes are the agent's (0090).
      actor: 'agent',
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

/**
 * Stand a launch beat down until the client says what its product is.
 *
 * ── WHY THE STATUS IS 'new' AND NOT 'generation_failed' ─────────────────────────────
 *
 * Nothing failed. `generation_failed` would be three separate untruths at once: `isOnTheWay`
 * collapses it into "On its way", so the client would be promised words that are not coming
 * (the exact untruth X2c had to undo for banked posts); `classifyGenerationFailure` would read
 * it as `deterministic` and file it in admin's Failed Posts as an OPERATOR item, when the only
 * person who can resolve it is the client; and `DetailSheet` hides Shape on both `!body` and
 * `onWay`, so the state that most needs an action would offer the fewest.
 *
 * `new` is the honest one: the post exists, it has no words, and nothing is working on it.
 * `plan-ready` settles on it (only 'generating' blocks), the sweep never sees it (it scans
 * `generation_failed` and stale `generating`), and the card renders the question below.
 *
 * The FLAG carries the fact and the SUBJECT carries the question, for the reason `quotaBanked`
 * splits the same way: copy gets reworded, and a state anything acts on must not be inferred
 * from a sentence.
 */
export async function markSubjectUngrounded(clientId: string, cycleId: string, postId: string, subject: string): Promise<void> {
  const [row] = await db
    .select({ sourceMeta: contentCyclePosts.sourceMeta })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.id, postId), eq(contentCyclePosts.clientId, clientId)))
    .limit(1);
  const meta = {
    ...((row?.sourceMeta ?? {}) as Record<string, unknown>),
    [UNGROUNDED_KEY]: true,
    [UNGROUNDED_SUBJECT_KEY]: subject,
  };
  await db.update(contentCyclePosts)
    .set({ status: 'new', sourceMeta: meta })
    .where(and(
      eq(contentCyclePosts.id, postId),
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
    ));
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
