/**
 * queue.ts — server-side BullMQ access for the regen seam. The app ENQUEUES a
 * `shape` job onto the 'content-cycles' queue (the worker runs the Bedrock rewrite)
 * and reads job state back. Mirrors admin's planning-enqueue pattern. No Bedrock,
 * no @sprigly/workflows here — enqueue + read only.
 */
import { Queue } from 'bullmq';

export interface ShapePayload {
  type:         'shape';
  scope:        'post' | 'plan';
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

/** Enqueue a shape job. Clears a stale completed/failed slot first (prepareJobSlot);
 *  if one is already active/waiting, returns its id rather than duplicating. */
export async function enqueueShape(payload: ShapePayload): Promise<{ jobId: string } | { error: string }> {
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
        return { jobId };   // already active/waiting
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

export type JobView =
  | { status: 'pending' }
  | { status: 'done'; changedPostIds: string[]; summary: string }
  | { status: 'error'; summary: string }
  | { status: 'gone' };

/** Read a shape job's state + returnvalue from BullMQ. */
export async function readShapeJob(jobId: string): Promise<JobView> {
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
