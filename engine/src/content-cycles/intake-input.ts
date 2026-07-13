/**
 * intake-input.ts — "has ANY planning input landed for this cycle?" predicate.
 *
 * Used by the auto-run branch (scheduler.ts) to log/decide whether a run would proceed on
 * a real intake or on the empty baseline. Two sources, OR'd:
 *   1. the cycle's own intake_json.planContent — mirrors the confirmIntake guard exactly
 *      (any non-empty answer OR non-empty freeNotes);
 *   2. a live durable plan_input (type 'idea' | 'next_cycle') for this client created since
 *      the cycle was created — durable context captured during this cycle's window.
 *
 * NOTE: plan_inputs are only READ here as a predicate. Generation does not consume durable
 * context until Build 3; this file adds no consumption.
 */
import { and, eq, gte, inArray } from 'drizzle-orm';
import { db as _db, planInputs } from '@sprigly/db';
import type { IntakeJson } from '@sprigly/engine';

type Db = typeof _db;

/**
 * Pure: intake has content iff any answer or the free notes are non-empty after trimming.
 * Mirrors the admin confirmIntake guard (intake-actions.ts) — same predicate, one place.
 */
export function hasIntakeContent(intakeJson: IntakeJson | null | undefined): boolean {
  const answers   = intakeJson?.planContent?.answers ?? {};
  const freeNotes = (intakeJson?.planContent?.freeNotes ?? '').trim();
  return freeNotes.length > 0 || Object.values(answers).some((v) => (v ?? '').trim().length > 0);
}

/** The cycle fields the predicate needs. */
export interface IntakeInputCycle {
  clientId:   string;
  createdAt:  Date;
  intakeJson: unknown;   // IntakeJson | null
}

/** Durable plan_input types that count as "input landed" for a cycle window.
 *  Mutable string[] (not readonly) so drizzle inArray accepts it directly. */
export const DURABLE_INPUT_TYPES: string[] = ['idea', 'next_cycle'];

/**
 * True if ANY planning input has landed for this cycle: the cycle's own intake content, OR a
 * live idea/next_cycle plan_input for this client created at/after the cycle's creation. The
 * recency bound (created since the cycle) is enforced in SQL so stale durable notes from a
 * previous cycle do not count.
 */
export async function hasAnyIntakeInput(db: Db, cycle: IntakeInputCycle): Promise<boolean> {
  if (hasIntakeContent(cycle.intakeJson as IntakeJson | null)) return true;

  const rows = await db
    .select({ id: planInputs.id })
    .from(planInputs)
    .where(and(
      eq(planInputs.clientId, cycle.clientId),
      inArray(planInputs.type, DURABLE_INPUT_TYPES),
      eq(planInputs.status, 'active'),
      gte(planInputs.createdAt, cycle.createdAt),
    ))
    .limit(1);

  return rows.length > 0;
}
