/**
 * weekly-cron.ts — the weekly session's repeatable-cron registration + fan-out.
 *
 * registerWeeklySessionCron registers ONE repeatable tick (Monday 06:00
 * Europe/London), but ONLY when WEEKLY_SESSION_CRON_ENABLED is truthy — off by
 * default until we trust the session. runWeeklySessionTick fans the tick out to a
 * per-client 'weekly-session' job for every client that has an active editable
 * cycle (one per client, the most recent), targeting the upcoming week.
 */
import { eq } from 'drizzle-orm';
import { db as _db, contentCycles } from '@sprigly/db';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { WeeklySessionJob } from './weekly-session.js';

type Db = typeof _db;

export const WEEKLY_SESSION_CRON_PATTERN = '0 6 * * 1';   // Monday 06:00
const weeklySessionJobId = (cycleId: string, weekStart: string) => `weekly_${cycleId}_${weekStart}`;

// Cycle statuses considered live + editable enough to audit weekly.
const AUDITABLE_STATUSES: ReadonlyArray<string> = ['active', 'delivered', 'finalised'];

/** Register the Monday cron — only when explicitly enabled. Returns whether it registered. */
export async function registerWeeklySessionCron(queue: Queue, enabled: boolean, logger?: Logger): Promise<boolean> {
  if (!enabled) {
    logger?.info('weekly-session: cron disabled (WEEKLY_SESSION_CRON_ENABLED not set) — not registered');
    return false;
  }
  await queue.add(
    'weekly-session-tick',
    { type: 'weekly-session-tick' },
    { repeat: { pattern: WEEKLY_SESSION_CRON_PATTERN, tz: 'Europe/London' } },
  );
  logger?.info('weekly-session: cron registered (Monday 06:00 Europe/London)');
  return true;
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

/** Fan the Monday tick out to one weekly-session job per client with an active cycle. */
export async function runWeeklySessionTick(deps: { db: Db; queue: Queue; logger: Logger }, now: Date = new Date()): Promise<void> {
  const { db, queue, logger } = deps;
  const weekStart = londonWeekStart(now);

  const rows = await db
    .select({ id: contentCycles.id, clientId: contentCycles.clientId, status: contentCycles.status, createdAt: contentCycles.createdAt })
    .from(contentCycles);

  // One cycle per client — the most recent auditable one.
  const perClient = new Map<string, { id: string; clientId: string; createdAt: Date }>();
  for (const c of rows) {
    if (!AUDITABLE_STATUSES.includes(c.status)) continue;
    const cur = perClient.get(c.clientId);
    if (!cur || c.createdAt > cur.createdAt) perClient.set(c.clientId, { id: c.id, clientId: c.clientId, createdAt: c.createdAt });
  }

  logger.info({ weekStart, count: perClient.size }, 'weekly-session: tick fanning out');
  for (const c of perClient.values()) {
    const job: WeeklySessionJob = { type: 'weekly-session', clientId: c.clientId, cycleId: c.id, weekStart };
    await queue.add('weekly-session', job, {
      jobId: weeklySessionJobId(c.id, weekStart), attempts: 1,
      removeOnComplete: { age: 86400, count: 100 }, removeOnFail: { age: 86400 },
    });
  }
}
