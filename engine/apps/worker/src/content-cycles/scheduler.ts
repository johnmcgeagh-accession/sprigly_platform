/**
 * scheduler.ts — Content-cycle scheduler for the 'content-cycles' BullMQ queue.
 *
 * enqueueCycleForClient:  shared enqueue path used by the tick AND any future manual trigger.
 *   - DB-level dedup: skips if a content_cycles row already exists in 'requested' (or beyond).
 *   - Seeds a 'scheduled' cycle row so runRequestEmail can find it when the chain completes.
 *   - BullMQ dedup: uses a deterministic jobId so re-enqueues are no-ops while the job is pending.
 *
 * runContentCycleTick:  called by the 'scheduler-tick' BullMQ repeatable job (05:00 Europe/London).
 *   - Queries clients WHERE content_cycle_enabled = true. Zero clients are enabled by default.
 *   - Reads calendar-config.json from each client's Drive folder for their trigger schedule.
 *   - Skips clients not yet due this calendar month (today's London day < schedule.day).
 *   - Calls enqueueCycleForClient for each due client.
 *
 * SAFETY: content_cycle_enabled defaults to false in the DB. Nothing in this file sets it to true.
 *         No client runs automatically until the column is explicitly enabled per-row in the DB.
 */

import { eq, and } from 'drizzle-orm';
import { db as _db, clients, clientChannels, contentCycles } from '@sprigly/db';
import { getTokens, storeTokens, type EncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { IG_TRAWL_JOB_OPTIONS, igTrawlJobId } from './job-options.js';

type Db = typeof _db;

// Statuses indicating the cycle for this (client, channel, month) is already underway.
// 'scheduled'  is intentionally absent: the row exists but the BullMQ job may have been
//              lost from Redis. We re-enqueue; the deterministic jobId prevents duplication.
// 'failed'     is intentionally absent: allows the scheduler to retry a failed cycle next tick.
const ACTIVE_STATUSES: ReadonlyArray<string> = [
  'requested', 'reply_received', 'awaiting_confirmation', 'intake_confirmed',
  'planning', 'workbook_built', 'delivered', 'active', 'finalised',
  'awaiting_voice_approval', 'voice_merged', 'closed',
];

export interface CycleSchedule {
  day:  number;  // day-of-month (1–28) on which the cycle triggers
  hour: number;  // hour in Europe/London (stored; not used by the daily tick currently)
}

const DEFAULT_SCHEDULE: CycleSchedule = { day: 1, hour: 6 };

export function parseCycleSchedule(
  config: Record<string, unknown>,
  logger: Logger,
  logCtx: Record<string, unknown>,
): CycleSchedule {
  const raw = config['content_cycle_schedule'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    logger.info({ ...logCtx, schedule: DEFAULT_SCHEDULE },
      'content-cycle-scheduler: content_cycle_schedule absent — using default');
    return { ...DEFAULT_SCHEDULE };
  }
  const r = raw as Record<string, unknown>;
  const day  = typeof r['day']  === 'number' ? Math.max(1, Math.min(28, r['day']))  : DEFAULT_SCHEDULE.day;
  const hour = typeof r['hour'] === 'number' ? Math.max(0, Math.min(23, r['hour'])) : DEFAULT_SCHEDULE.hour;
  return { day, hour };
}

export function getLondonToday(now: Date = new Date()): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  return {
    year:  parseInt(parts.find(p => p.type === 'year')?.value  ?? '2000', 10),
    month: parseInt(parts.find(p => p.type === 'month')?.value ?? '1',    10),
    day:   parseInt(parts.find(p => p.type === 'day')?.value   ?? '1',    10),
  };
}

// Last completed calendar month: the month before today's.
// e.g. any day in June 2026 → '2026-05';  any day in January 2027 → '2026-12'.
export function getDataMonth(today: { year: number; month: number }): string {
  const y = today.month === 1 ? today.year - 1 : today.year;
  const m = today.month === 1 ? 12             : today.month - 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function isDue(schedule: CycleSchedule, today: { day: number }): boolean {
  return today.day >= schedule.day;
}

// Shared enqueue path used by the scheduler tick and any manual admin trigger.
// Idempotent: calling multiple times for the same (clientId, channel, dataMonth) is safe.
export async function enqueueCycleForClient(params: {
  db:        Db;
  queue:     Queue;
  clientId:  string;
  channel:   string;
  dataMonth: string;
  logger:    Logger;
}): Promise<'enqueued' | 'skipped'> {
  const { db, queue, clientId, channel, dataMonth, logger } = params;
  const logCtx = { clientId, channel, dataMonth };

  // DB-level dedup: skip if the cycle is already active (real guarantee).
  // This check is the authoritative gate; BullMQ jobId dedup is the cheap early-out.
  const existingRows = await db
    .select({ status: contentCycles.status })
    .from(contentCycles)
    .where(and(
      eq(contentCycles.clientId,   clientId),
      eq(contentCycles.channel,    channel),
      eq(contentCycles.cycleMonth, dataMonth),
    ))
    .limit(1);

  const existing = existingRows[0];
  if (existing && ACTIVE_STATUSES.includes(existing.status)) {
    logger.info({ ...logCtx, cycleStatus: existing.status },
      'content-cycle-scheduler: cycle already active — skipping');
    return 'skipped';
  }

  // Seed the cycle row so runRequestEmail (chained after ig-trawl) can find it.
  // ON CONFLICT DO NOTHING handles re-runs where the row is already 'scheduled' or 'failed'.
  await db
    .insert(contentCycles)
    .values({ clientId, channel, cycleMonth: dataMonth, status: 'scheduled' })
    .onConflictDoNothing();

  // Deterministic jobId — BullMQ deduplicates if the job is already pending in the queue.
  const jobId = igTrawlJobId(clientId, channel, dataMonth);
  await queue.add(
    'ig-trawl',
    { type: 'ig-trawl', clientId, channel, dataMonth },
    { ...IG_TRAWL_JOB_OPTIONS, jobId },
  );

  logger.info({ ...logCtx, jobId }, 'content-cycle-scheduler: enqueued ig-trawl');
  return 'enqueued';
}

export async function runContentCycleTick(params: {
  db:                 Db;
  queue:              Queue;
  encProvider:        EncryptionProvider;
  googleClientId:     string;
  googleClientSecret: string;
  logger:             Logger;
  now?:               Date;  // injectable for tests; defaults to new Date()
}): Promise<void> {
  const { db, queue, encProvider, googleClientId, googleClientSecret, logger } = params;
  const now = params.now ?? new Date();

  const today     = getLondonToday(now);
  const dataMonth = getDataMonth(today);
  logger.info({ today, dataMonth }, 'content-cycle-scheduler: tick started');

  const enabledRows = await db
    .select({
      clientId:      clientChannels.clientId,
      channel:       clientChannels.channel,
      driveFolderId: clientChannels.driveFolderId,
    })
    .from(clientChannels)
    .innerJoin(clients, eq(clientChannels.clientId, clients.id))
    .where(eq(clients.contentCycleEnabled, true));

  if (enabledRows.length === 0) {
    logger.info({}, 'content-cycle-scheduler: no enabled clients — done');
    return;
  }

  let enqueued = 0;
  let skipped  = 0;

  for (const row of enabledRows) {
    const { clientId, channel, driveFolderId } = row;
    const logCtx = { clientId, channel, dataMonth };

    try {
      if (!driveFolderId) {
        logger.warn({ ...logCtx }, 'content-cycle-scheduler: no driveFolderId — skipping client');
        skipped++;
        continue;
      }

      const tokens = await getTokens(db, encProvider, clientId, 'drive');
      if (!tokens) {
        logger.warn({ ...logCtx }, 'content-cycle-scheduler: no Drive tokens — skipping client');
        skipped++;
        continue;
      }

      const drive = new DriveApiClient(googleClientId, googleClientSecret, tokens, async (t) => {
        try { await storeTokens(db, encProvider, clientId, 'drive', t); }
        catch (err) { logger.warn({ ...logCtx, err }, 'content-cycle-scheduler: token refresh write-back failed'); }
      });

      const files = await drive.listFiles(driveFolderId);
      const cfgMeta = (files as Array<{ id: string; name: string }>)
        .find(f => f.name === 'calendar-config.json');

      let schedule: CycleSchedule;
      if (!cfgMeta) {
        logger.info({ ...logCtx }, 'content-cycle-scheduler: no calendar-config.json — using default schedule');
        schedule = { ...DEFAULT_SCHEDULE };
      } else {
        const buf = await drive.downloadFile(cfgMeta.id);
        const cfg = JSON.parse((buf as Buffer).toString('utf-8')) as Record<string, unknown>;
        schedule = parseCycleSchedule(cfg, logger, logCtx);
      }

      if (!isDue(schedule, today)) {
        logger.info({ ...logCtx, schedule, todayDay: today.day },
          'content-cycle-scheduler: not yet due — skipping');
        skipped++;
        continue;
      }

      const result = await enqueueCycleForClient({ db, queue, clientId, channel, dataMonth, logger });
      if (result === 'enqueued') enqueued++;
      else skipped++;

    } catch (err) {
      logger.warn({ ...logCtx, err: String(err) },
        'content-cycle-scheduler: error processing client — skipping');
      skipped++;
    }
  }

  logger.info({ dataMonth, enqueued, skipped }, 'content-cycle-scheduler: tick complete');
}
