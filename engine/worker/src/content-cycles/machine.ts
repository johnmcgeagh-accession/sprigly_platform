/**
 * machine.ts — content_cycles state machine.
 *
 * isAllowedTransition: pure guard, unit-testable without DB.
 * transitionCycle: load → guard → update → return new row.
 *
 * failed → prior_status is the retry path; prior_status is set automatically
 * when any state transitions to 'failed', and cleared on retry.
 */

import { eq } from 'drizzle-orm';
import { db as _db, contentCycles } from '@sprigly/db';
import type { ContentCycle, CycleStatus } from '@sprigly/db';
import type { Logger } from 'pino';

type Db = typeof _db;

// All legal (from, to) pairs as "from->to" strings.
// 'failed → prior_status' is handled dynamically (see isAllowedTransition).
const ALLOWED: ReadonlySet<string> = new Set([
  'scheduled->requested',
  'requested->reply_received',
  'requested->intake_confirmed',           // no-reply fallback
  'reply_received->awaiting_confirmation',
  'reply_received->intake_confirmed',
  'awaiting_confirmation->intake_confirmed',
  'intake_confirmed->planning',
  'planning->workbook_built',              // DrivePoller detects built workbook
  'workbook_built->delivered',             // delivery worker: share + email
  'delivered->active',
  'active->finalised',
  'finalised->awaiting_voice_approval',
  'awaiting_voice_approval->voice_merged',
  'voice_merged->closed',
  // any state → failed
  'scheduled->failed',
  'requested->failed',
  'reply_received->failed',
  'awaiting_confirmation->failed',
  'intake_confirmed->failed',
  'planning->failed',
  'workbook_built->failed',
  'delivered->failed',
  'active->failed',
  'finalised->failed',
  'awaiting_voice_approval->failed',
  'voice_merged->failed',
]);

/** Pure guard — no DB. Used directly by unit tests. */
export function isAllowedTransition(
  from:        CycleStatus,
  to:          CycleStatus,
  priorStatus: CycleStatus | null | undefined,
): boolean {
  if (ALLOWED.has(`${from}->${to}`)) return true;
  // 'failed → prior_status' retry: only allowed when to === priorStatus.
  if (from === 'failed' && priorStatus != null && to === priorStatus) return true;
  return false;
}

type CycleUpdate = Partial<Omit<
  typeof contentCycles.$inferInsert,
  'id' | 'clientId' | 'channel' | 'cycleMonth' | 'status' | 'priorStatus' | 'createdAt' | 'updatedAt'
>>;

/** Load, guard, update, return new row. Throws on illegal transition. */
export async function transitionCycle(
  db:      Db,
  cycleId: string,
  to:      CycleStatus,
  updates: CycleUpdate = {},
  logger?: Logger,
): Promise<ContentCycle> {
  const rows = await db
    .select()
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);

  const cycle = rows[0];
  if (!cycle) throw new Error(`transitionCycle: cycle ${cycleId} not found`);

  const from        = cycle.status as CycleStatus;
  const priorStatus = cycle.priorStatus as CycleStatus | null;

  if (!isAllowedTransition(from, to, priorStatus)) {
    const msg = `content-cycles: illegal transition ${from}→${to} for cycle ${cycleId}`;
    logger?.warn({ cycleId, from, to }, msg);
    throw new Error(msg);
  }

  const now = new Date();

  const patch: Partial<typeof contentCycles.$inferInsert> = {
    status:    to,
    updatedAt: now,
    ...updates,
  };

  // Capture prior state so retry knows where to return.
  if (to === 'failed')   patch.priorStatus = from;
  // Clear prior state once retried.
  if (from === 'failed') patch.priorStatus = null;

  const updated = await db
    .update(contentCycles)
    .set(patch)
    .where(eq(contentCycles.id, cycleId))
    .returning();

  const newCycle = updated[0];
  if (!newCycle) throw new Error(`transitionCycle: update returned no row for ${cycleId}`);

  logger?.info(
    {
      cycleId,
      clientId:   cycle.clientId,
      channel:    cycle.channel,
      cycleMonth: cycle.cycleMonth,
      from,
      to,
    },
    'content-cycles: transition',
  );

  return newCycle;
}
