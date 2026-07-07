import 'server-only';
import { Queue } from 'bullmq';

// The admin "Run weekly session" enqueue site. Mirrors planning-enqueue.ts:
// deterministic jobId (one per cycle+week), stale-slot clearing, active-guard.
const WEEKLY_JOB_OPTIONS = { attempts: 1 };
export function weeklySessionJobId(cycleId: string, weekStart: string): string {
  return `weekly_${cycleId}_${weekStart}`;
}

/** Monday (Europe/London) of the week containing `now`, as 'YYYY-MM-DD'. */
export function londonWeekStart(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dow = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[get('weekday')] ?? 0;
  const d = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

async function prepareJobSlot(queue: Queue, jobId: string): Promise<{ ok: boolean; message?: string }> {
  const existing = await queue.getJob(jobId);
  if (!existing) return { ok: true };
  const state = await existing.getState();
  if (state === 'active' || state === 'waiting' || state === 'delayed') {
    return { ok: false, message: 'A weekly session for this week is already queued or running — wait for it to finish.' };
  }
  if (state === 'completed' || state === 'failed' || state === 'unknown') {
    try { await existing.remove(); } catch { /* best-effort */ }
  }
  return { ok: true };
}

/** Enqueue a weekly-session job for (client, cycle, week). Returns ok:false without
 *  enqueuing when one is already in flight or Redis is unavailable. */
export async function enqueueWeeklySession(
  clientId: string,
  cycleId: string,
  weekStart: string,
): Promise<{ ok: boolean; message?: string }> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('[enqueueWeeklySession] REDIS_URL not set — weekly session not enqueued');
    return { ok: false, message: 'Server not configured for background jobs (REDIS_URL missing).' };
  }
  const queue = new Queue('content-cycles', { connection: { url: redisUrl } });
  try {
    const jobId = weeklySessionJobId(cycleId, weekStart);
    const slot = await prepareJobSlot(queue, jobId);
    if (!slot.ok) return slot;
    await queue.add('weekly-session', { type: 'weekly-session', clientId, cycleId, weekStart }, { ...WEEKLY_JOB_OPTIONS, jobId });
    return { ok: true };
  } finally {
    await queue.close();
  }
}
