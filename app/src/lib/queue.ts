/**
 * queue.ts — server-side BullMQ access for the regen seam. The app ENQUEUES a
 * `shape` job onto the 'content-cycles' queue (the worker runs the Bedrock rewrite)
 * and reads job state back. Mirrors admin's planning-enqueue pattern. No Bedrock,
 * no @sprigly/workflows here — enqueue + read only.
 */
import { Queue } from 'bullmq';
import type { PlanActor } from '@sprigly/db';
import { e2eFakeEnabled, E2E_SHAPED_CAPTION, E2E_HOOK_CANDIDATES, E2E_SCRIPT_TEXT, E2E_PAIR_HOOK, E2E_REFINED_HOOK, E2E_REFINED_SCRIPT } from '@/lib/e2e-fake';

export interface ShapePayload {
  type:         'shape';
  scope:        'post' | 'plan';
  clientId:     string;
  cycleId:      string;
  targetPostId: string;
  instruction:  string;
  source:       'web' | 'voice';
  proposalId?:  string;   // set when this rewrite applied an approved proposal (ledger ref)
  target?:      'caption' | 'hook' | 'script';   // which field the instruction refines (§26)
  // WHOSE INTENT this job carries (0090). The worker cannot work it out — by the time shape.ts
  // runs, the session that caused it is long gone — so the enqueuer states it. Absent means
  // nobody asked in the moment; the worker defaults to 'agent'.
  actor?:       PlanActor;
  // WHOSE MONEY this job spends (0094). A different question from `actor` and answered
  // differently on recovery paths — see engine/.../shape.ts for why the two cannot share a
  // field. Absent means BILLABLE: an exemption has to be stated, never inferred.
  billable?:    boolean;
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
/**
 * Retry policy for the per-post GENERATION jobs (caption / hook / script).
 *
 * These carried `attempts: 1` — no retry at all — on the reasoning that a failed generation
 * is usually a bad response rather than a flaky connection. The Build D dogfood run
 * disproved the premise: 1 post in 10 failed on a Bedrock 180s TIMEOUT, which is exactly
 * the transient case retrying fixes, and with no retry the client had to notice and press
 * regenerate themselves.
 *
 * Pattern taken from IG_TRAWL_JOB_OPTIONS (engine/.../job-options.ts:3-6) — the platform's
 * existing answer to a network-flaky external call — with a smaller attempt count because
 * each attempt here is a paid Bedrock call, not a scrape. 3 attempts = 1 try + 2 retries,
 * exponential from 5s, so a transient timeout self-heals without three identical bills for
 * a response that was never going to parse.
 *
 * generation_failed remains the backstop: it is stamped only once retries are exhausted
 * (see runShapeForCycle's isFinalAttempt), so a post that recovers on attempt 2 never shows
 * the client a failure that did not stick.
 */
export const GENERATION_JOB_OPTIONS = {
  attempts: 3,
  backoff:  { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail:     { age: 3600 },
};

export async function enqueueShape(payload: ShapePayload): Promise<EnqueueResult> {
  if (e2eFakeEnabled()) {
    // e2e: no Redis/Bedrock. Write the canned text for the TARGET field straight onto the
    // post so a subsequent poll returns 'done' with the swapped value. Dynamic imports keep
    // @sprigly/db out of this module's top level (the offline queue.test never loads it).
    const { db, contentCyclePosts } = await import('@sprigly/db');
    const { and, eq } = await import('drizzle-orm');
    const set = payload.target === 'hook' ? { hook: E2E_REFINED_HOOK, status: 'edited' as const }
      : payload.target === 'script' ? { script: E2E_REFINED_SCRIPT, status: 'edited' as const }
      : { caption: E2E_SHAPED_CAPTION, status: 'edited' as const };
    await db.update(contentCyclePosts)
      .set(set)
      .where(and(eq(contentCyclePosts.id, payload.targetPostId), eq(contentCyclePosts.clientId, payload.clientId)));
    // Mirror the worker's ledger for the new refine path so e2e can assert it (the caption
    // path's ledger is already covered elsewhere; only add hook/script here).
    if (payload.target === 'hook' || payload.target === 'script') {
      const { planActivity } = await import('@sprigly/db');
      await db.insert(planActivity).values({
        clientId: payload.clientId, cycleId: payload.cycleId, postId: payload.targetPostId,
        origin: 'agent', actor: payload.actor ?? 'agent',
        action: payload.target === 'hook' ? 'hook_saved' : 'script_saved',
        refProposalId: payload.proposalId ?? null,
      });
    }
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
      ...GENERATION_JOB_OPTIONS,
    });
    return { jobId };
  } catch (err) {
    return { error: String(err) };
  }
}

// ── Hook generation (Stage 6, reels + carousels) ───────────────────────────────
export interface HookPayload {
  type:         'hook';
  clientId:     string;
  cycleId:      string;
  targetPostId: string;
  /** Fan-out mode: the worker persists the top candidate (hook.ts). Absent = interactive. */
  autoSelect?: boolean;
}
export const hookJobId = (cycleId: string, postId: string) => `hook_${cycleId}_${postId}`;

export type HookJobView =
  | { status: 'pending' }
  | { status: 'done'; candidates: string[] }
  | { status: 'error'; summary: string }
  | { status: 'gone' };

/** Enqueue a hook-generation job. Candidates are returned via the job (NOT written to
 *  the post — the user picks + saves). Fake path returns a jobId; readHookJob returns the
 *  canned candidates so the e2e loop is deterministic without Redis/Bedrock. */
export async function enqueueHookJob(payload: HookPayload): Promise<EnqueueResult> {
  if (e2eFakeEnabled()) return { jobId: hookJobId(payload.cycleId, payload.targetPostId) };
  const queue = getQueue();
  if (!queue) return { error: 'Server not configured for background jobs (REDIS_URL missing).' };
  const jobId = hookJobId(payload.cycleId, payload.targetPostId);
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
    await queue.add('hook', payload, { jobId, ...GENERATION_JOB_OPTIONS });
    return { jobId };
  } catch (err) {
    return { error: String(err) };
  }
}

/** Read a hook job's candidates. Fake path returns the canned set immediately. */
export async function readHookJob(jobId: string): Promise<HookJobView> {
  if (e2eFakeEnabled()) return { status: 'done', candidates: E2E_HOOK_CANDIDATES };
  const queue = getQueue();
  if (!queue) return { status: 'error', summary: 'Background jobs unavailable.' };
  const job = await queue.getJob(jobId);
  if (!job) return { status: 'gone' };
  const state = await job.getState();
  if (state === 'completed') {
    const rv = (job.returnvalue ?? {}) as { candidates?: string[] };
    return { status: 'done', candidates: rv.candidates ?? [] };
  }
  if (state === 'failed') return { status: 'error', summary: job.failedReason || 'Could not generate hooks.' };
  return { status: 'pending' };
}

// ── Script generation (Stage 6, reels only) ────────────────────────────────────
export interface ScriptPayload {
  type:          'script';
  clientId:      string;
  cycleId:       string;
  targetPostId:  string;
  lengthSeconds: number;   // 15 | 30 | 60 | 90
}
export const scriptJobId = (cycleId: string, postId: string) => `script_${cycleId}_${postId}`;

/** Enqueue a script job. The worker writes the script onto the post (like shape), so the
 *  poll returns 'done' and the plan re-reads. Fake path writes the canned script + length
 *  straight onto the post so the e2e loop is deterministic without Redis/Bedrock. */
export async function enqueueScriptJob(payload: ScriptPayload): Promise<EnqueueResult> {
  if (e2eFakeEnabled()) {
    const { db, contentCyclePosts } = await import('@sprigly/db');
    const { and, eq } = await import('drizzle-orm');
    // BOTH FIELDS. The real job writes the pair (C4) — a hook and a script that say the same
    // thing — and a fake that wrote only half of it modelled a behaviour that no longer exists.
    // That gap is what left the reel's combined act unobservable in e2e.
    await db.update(contentCyclePosts)
      .set({ hook: E2E_PAIR_HOOK, script: E2E_SCRIPT_TEXT, scriptLengthSeconds: payload.lengthSeconds })
      .where(and(eq(contentCyclePosts.id, payload.targetPostId), eq(contentCyclePosts.clientId, payload.clientId)));
    return { jobId: scriptJobId(payload.cycleId, payload.targetPostId) };
  }
  const queue = getQueue();
  if (!queue) return { error: 'Server not configured for background jobs (REDIS_URL missing).' };
  const jobId = scriptJobId(payload.cycleId, payload.targetPostId);
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
    await queue.add('script', payload, { jobId, ...GENERATION_JOB_OPTIONS });
    return { jobId };
  } catch (err) {
    return { error: String(err) };
  }
}

/** Read a script job's state (the script is written onto the post, like shape). */
export async function readScriptJob(jobId: string): Promise<JobView> {
  if (e2eFakeEnabled()) {
    const postId = jobId.split('_').slice(2).join('_');
    return { status: 'done', changedPostIds: [postId], summary: 'Wrote your reel script.' };
  }
  const queue = getQueue();
  if (!queue) return { status: 'error', summary: 'Background jobs unavailable.' };
  const job = await queue.getJob(jobId);
  if (!job) return { status: 'gone' };
  const state = await job.getState();
  if (state === 'completed') {
    const rv = (job.returnvalue ?? {}) as { changedPostIds?: string[]; summary?: string };
    return { status: 'done', changedPostIds: rv.changedPostIds ?? [], summary: rv.summary ?? 'Wrote your reel script.' };
  }
  if (state === 'failed') return { status: 'error', summary: job.failedReason || 'Could not write the script.' };
  return { status: 'pending' };
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
    return { status: 'error', summary: job.failedReason || 'Could not make that change. Left it as it was.' };
  }
  return { status: 'pending' };
}
