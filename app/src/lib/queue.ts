/**
 * queue.ts — server-side BullMQ access for the regen seam. The app ENQUEUES a
 * `shape` job onto the 'content-cycles' queue (the worker runs the Bedrock rewrite)
 * and reads job state back. Mirrors admin's planning-enqueue pattern. No Bedrock,
 * no @sprigly/workflows here — enqueue + read only.
 */
import { Queue } from 'bullmq';
import { e2eFakeEnabled, E2E_SHAPED_CAPTION } from '@/lib/e2e-fake';

export interface ShapePayload {
  type:         'shape';
  scope:        'post' | 'plan';
  clientId:     string;
  cycleId:      string;
  targetPostId: string;
  instruction:  string;
  source:       'web' | 'voice';
}

function getQueue(): Queue | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return new Queue('content-cycles', { connection: { url } });
}

export const shapeJobId = (cycleId: string, postId: string) => `shape_${cycleId}_${postId}`;

/**
 * Enqueue result. `busy` means a job for this exact post is already
 * active/waiting — the new instruction was NOT enqueued (the deterministic
 * jobId is one-per-post). Callers must surface this explicitly rather than
 * treat the returned jobId as if the new instruction had been accepted, or a
 * second instruction is silently lost (audit §7.5).
 */
export type EnqueueResult =
  | { jobId: string }
  | { busy: true; jobId: string }
  | { error: string };

/** Enqueue a shape job. Clears a stale completed/failed slot first; if one is
 *  already active/waiting, returns `{ busy: true, jobId }` WITHOUT enqueuing —
 *  the caller decides how to tell the user. */
export async function enqueueShape(payload: ShapePayload): Promise<EnqueueResult> {
  if (e2eFakeEnabled()) {
    // e2e: no Redis/Bedrock. Write the canned caption straight onto the post so a
    // subsequent poll returns 'done' with the swapped caption. Dynamic imports keep
    // @sprigly/db out of this module's top level (the offline queue.test never loads it).
    const { db, contentCyclePosts } = await import('@sprigly/db');
    const { and, eq } = await import('drizzle-orm');
    await db.update(contentCyclePosts)
      .set({ caption: E2E_SHAPED_CAPTION, status: 'edited' })
      .where(and(eq(contentCyclePosts.id, payload.targetPostId), eq(contentCyclePosts.clientId, payload.clientId)));
    return { jobId: shapeJobId(payload.cycleId, payload.targetPostId) };
  }
  const queue = getQueue();
  if (!queue) return { error: 'Server not configured for background jobs (REDIS_URL missing).' };
  const jobId = shapeJobId(payload.cycleId, payload.targetPostId);
  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed' || state === 'unknown') {
        try { await existing.remove(); } catch { /* best-effort */ }
      } else {
        // A change for this post is still in flight. Do NOT silently drop the
        // new instruction by returning this jobId as success.
        return { busy: true, jobId };
      }
    }
    await queue.add('shape', payload, {
      jobId,
      attempts: 1,
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail:     { age: 3600 },
    });
    return { jobId };
  } catch (err) {
    return { error: String(err) };
  }
}

export interface WeeklySessionPayload {
  type:      'weekly-session';
  clientId:  string;
  cycleId:   string;
  weekStart: string;   // Monday, 'YYYY-MM-DD'
}

export const weeklySessionJobId = (cycleId: string, weekStart: string) => `weekly_${cycleId}_${weekStart}`;

/** Enqueue a weekly planning session for a cycle+week. Dedups on the deterministic
 *  jobId so a manual re-trigger while one is in flight returns busy. */
export async function enqueueWeeklySession(payload: WeeklySessionPayload): Promise<EnqueueResult> {
  const queue = getQueue();
  if (!queue) return { error: 'Server not configured for background jobs (REDIS_URL missing).' };
  const jobId = weeklySessionJobId(payload.cycleId, payload.weekStart);
  try {
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed' || state === 'unknown') {
        try { await existing.remove(); } catch { /* best-effort */ }
      } else {
        return { busy: true, jobId };
      }
    }
    await queue.add('weekly-session', payload, { jobId, attempts: 1, removeOnComplete: { age: 86400, count: 100 }, removeOnFail: { age: 86400 } });
    return { jobId };
  } catch (err) {
    return { error: String(err) };
  }
}

export type JobView =
  | { status: 'pending' }
  | { status: 'done'; changedPostIds: string[]; summary: string }
  | { status: 'error'; summary: string }
  | { status: 'gone' };

/** Read a shape job's state + returnvalue from BullMQ. */
export async function readShapeJob(jobId: string): Promise<JobView> {
  if (e2eFakeEnabled()) {
    // The fake enqueue already applied the caption; report done immediately.
    const postId = jobId.split('_').slice(2).join('_');
    return { status: 'done', changedPostIds: [postId], summary: 'Rewritten in your voice.' };
  }
  const queue = getQueue();
  if (!queue) return { status: 'error', summary: 'Background jobs unavailable.' };
  const job = await queue.getJob(jobId);
  if (!job) return { status: 'gone' };
  const state = await job.getState();
  if (state === 'completed') {
    const rv = (job.returnvalue ?? {}) as { changedPostIds?: string[]; summary?: string };
    return { status: 'done', changedPostIds: rv.changedPostIds ?? [], summary: rv.summary ?? 'Updated the caption.' };
  }
  if (state === 'failed') {
    return { status: 'error', summary: job.failedReason || 'Could not make that change — left it as it was.' };
  }
  return { status: 'pending' };
}
