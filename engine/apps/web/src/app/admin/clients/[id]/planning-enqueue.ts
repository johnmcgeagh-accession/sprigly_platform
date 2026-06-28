import 'server-only';
import { Queue } from 'bullmq';

// The ONE planning enqueue site — shared by confirmIntake (intake-actions.ts) and
// the "Run planning now" button (actions.ts). Mirrors the worker's job-options.
const PLANNING_JOB_OPTIONS = { attempts: 3, backoff: { type: 'fixed' as const, delay: 15_000 } };
export function planningJobId(cycleId: string): string { return `planning_${cycleId}`; }

/** Clear a stale completed/failed entry under this jobId before re-enqueue, so
 *  repeated firing works (BullMQ silently dedups against a corpse otherwise).
 *  'active' → a job is running; do NOT clear or re-add. */
async function prepareJobSlot(queue: Queue, jobId: string): Promise<{ ok: boolean; message?: string }> {
  const existing = await queue.getJob(jobId);
  if (!existing) return { ok: true };
  const state = await existing.getState();
  if (state === 'active') {
    return { ok: false, message: 'Planning is already running for this cycle — wait for it to finish.' };
  }
  if (state === 'completed' || state === 'failed' || state === 'unknown') {
    try { await existing.remove(); } catch { /* best-effort; proceed either way */ }
  }
  return { ok: true };
}

/**
 * Enqueue the planning job for a cycle. Returns ok:false (without enqueuing) when
 * a job is already running, or Redis is unavailable.
 *
 * `onSlotReady` runs ONLY once the slot is confirmed free (not active) and before
 * the job is added — callers put any cycle-state normalisation there so they never
 * mutate a cycle that already has a planning job mid-flight.
 */
export async function enqueuePlanning(
  cycleId:     string,
  onSlotReady?: () => Promise<void>,
): Promise<{ ok: boolean; message?: string }> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('[enqueuePlanning] REDIS_URL not set — planning job not enqueued');
    return { ok: false, message: 'Server not configured for background jobs (REDIS_URL missing).' };
  }
  const queue = new Queue('content-cycles', { connection: { url: redisUrl } });
  try {
    const jobId = planningJobId(cycleId);
    const slot = await prepareJobSlot(queue, jobId);
    if (!slot.ok) return slot;            // active → leave state + job untouched
    if (onSlotReady) await onSlotReady(); // safe to normalise cycle state now
    await queue.add('planning', { type: 'planning', cycleId }, { ...PLANNING_JOB_OPTIONS, jobId });
    return { ok: true };
  } finally {
    await queue.close();
  }
}
