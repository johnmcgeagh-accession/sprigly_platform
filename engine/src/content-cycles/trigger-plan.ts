/**
 * trigger-plan.ts — on-demand content-cycle creation for planning.
 *
 * Creates a content_cycles row already at status='intake_confirmed' for a chosen
 * PLAN month and enqueues the planning job — bypassing the scheduler's ig-trawl →
 * request-email chain and the admin confirmIntake empty-intake guard (that guard is
 * admin UX, not a pipeline requirement). Additive tooling: it does NOT touch
 * runPlanningForCycle, confirmIntake, the scheduler, or the state machine.
 *
 * The core (createOnDemandCycle) takes db + an injected `enqueue` so it is unit-
 * testable; the CLI wrapper (trigger-plan-cli.ts) supplies the real BullMQ enqueue.
 *
 * NEVER inserts or mutates a client_product_catalogue row (an empty {} row is a
 * known landmine for the hard catalogue validation).
 */

import { eq, and } from 'drizzle-orm';
import { db as _db, clients, clientChannels, contentCycles } from '@sprigly/db';
import type { IntakeJson } from '@sprigly/engine';
import type { Logger } from 'pino';

type Db = typeof _db;

export const MONTH_RE = /^\d{4}-\d{2}$/;

/** True for a well-formed YYYY-MM with a real month 01-12. */
export function isValidMonth(m: string): boolean {
  if (!MONTH_RE.test(m)) return false;
  const mm = Number(m.split('-')[1]);
  return mm >= 1 && mm <= 12;
}

/** "YYYY-MM" → the previous month's "YYYY-MM" (rolls the year at January).
 *  Matches drive-poller.ts prevMonth; the inverse of planning.ts nextMonth, so
 *  nextMonth(cycleMonthForPlanMonth(M)) === M. */
export function cycleMonthForPlanMonth(planMonth: string): string {
  const [y, m] = planMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1)); // m is 1-based; m-2 == previous month index
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface TriggerPlanParams {
  db:         Db;
  clientSlug: string;
  channel:    string;
  planMonth:  string;                        // the month the plan is FOR (YYYY-MM)
  intake?:    string | undefined;            // optional free-text intake → planContent.freeNotes
  enqueue:    (cycleId: string) => Promise<void>;  // injected BullMQ enqueue
  capturedAt?: string | undefined;           // ISO; injectable for tests (defaults to now)
  logger?:    Logger | undefined;
}

export interface TriggerPlanResult {
  ok:         boolean;
  message:    string;
  planMonth:  string;
  cycleMonth: string;
  cycleId?:   string | undefined;
  status?:    string | undefined;
  enqueued:   boolean;
}

/**
 * Resolve client/channel, refuse on a duplicate cycle, insert a fresh
 * status='intake_confirmed' cycle for cycleMonth = planMonth − 1, then enqueue
 * planning. Never upserts or mutates an existing cycle's status.
 */
export async function createOnDemandCycle(params: TriggerPlanParams): Promise<TriggerPlanResult> {
  const { db, clientSlug, channel, planMonth, intake, enqueue } = params;

  if (!isValidMonth(planMonth)) {
    return { ok: false, enqueued: false, planMonth, cycleMonth: '', message: `Invalid --plan-month "${planMonth}" — expected YYYY-MM with month 01-12.` };
  }
  const cycleMonth = cycleMonthForPlanMonth(planMonth);

  // Client must exist.
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, clientSlug)).limit(1);
  if (!client) {
    return { ok: false, enqueued: false, planMonth, cycleMonth, message: `Client not found: "${clientSlug}".` };
  }

  // Channel must exist for this client.
  const [chan] = await db
    .select({ id: clientChannels.id })
    .from(clientChannels)
    .where(and(eq(clientChannels.clientId, client.id), eq(clientChannels.channel, channel)))
    .limit(1);
  if (!chan) {
    return { ok: false, enqueued: false, planMonth, cycleMonth, message: `Channel "${channel}" not found for client "${clientSlug}".` };
  }

  // Duplicate guard: a cycle for (client, channel, cycleMonth) must not already exist.
  const [existing] = await db
    .select({ id: contentCycles.id, status: contentCycles.status })
    .from(contentCycles)
    .where(and(
      eq(contentCycles.clientId, client.id),
      eq(contentCycles.channel, channel),
      eq(contentCycles.cycleMonth, cycleMonth),
    ))
    .limit(1);
  if (existing) {
    return {
      ok: false, enqueued: false, planMonth, cycleMonth,
      cycleId: existing.id, status: existing.status,
      message: `A cycle already exists for ${clientSlug}/${channel}/${cycleMonth} (id ${existing.id}, status "${existing.status}"). Refusing to duplicate or mutate it.`,
    };
  }

  // Build intake_json (optional). Minimal free-notes intake, matching the admin
  // IntakeJson shape; null when no --intake is given (generation tolerates empty).
  const intakeJson: IntakeJson | null = intake
    ? {
        planContent:     { answers: {}, freeNotes: intake },
        businessContext: [],
        otherChannel:    {},
        source:          'manual',
        capturedAt:      params.capturedAt ?? new Date().toISOString(),
      }
    : null;

  // Insert at intake_confirmed. onConflictDoNothing guards a race with the check above.
  const inserted = await db
    .insert(contentCycles)
    .values({
      clientId:     client.id,
      channel,
      cycleMonth,
      status:       'intake_confirmed',
      intakeSource: intake ? 'manual' : null,
      intakeJson:   intakeJson as unknown,
    })
    .onConflictDoNothing()
    .returning({ id: contentCycles.id });

  const cycleId = inserted[0]?.id;
  if (!cycleId) {
    // Lost a race to another inserter — report the now-existing row, do not mutate.
    const [raced] = await db
      .select({ id: contentCycles.id, status: contentCycles.status })
      .from(contentCycles)
      .where(and(eq(contentCycles.clientId, client.id), eq(contentCycles.channel, channel), eq(contentCycles.cycleMonth, cycleMonth)))
      .limit(1);
    return {
      ok: false, enqueued: false, planMonth, cycleMonth,
      cycleId: raced?.id, status: raced?.status,
      message: `A cycle for ${clientSlug}/${channel}/${cycleMonth} was created concurrently — refusing to duplicate.`,
    };
  }

  await enqueue(cycleId);

  return {
    ok: true, enqueued: true, planMonth, cycleMonth,
    cycleId, status: 'intake_confirmed',
    message: `Created cycle ${cycleId} (status intake_confirmed) for plan month ${planMonth} → cycle_month ${cycleMonth}; planning job enqueued.`,
  };
}
