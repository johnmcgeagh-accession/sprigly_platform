/**
 * intake-signals.ts — the THREE distinct "has input?" questions, homed once so every surface
 * (worker scheduler, admin gates, admin display) reads the same derivation. They are NOT one
 * question — do not collapse them:
 *
 *   A  hasSuppressibleInput — "Has the client given us ANYTHING for this window, so we should
 *                             stop nagging?"  Drives reminder suppression + the "input landed"
 *                             display that explains it.
 *   B  hasPlannableInput    — "Is there enough to generate a REAL plan?"  Drives the planning
 *                             gates; tracks exactly what the generator consumes.
 *   (C — the form-completeness count — is pure + client-safe and lives in intake-completeness.ts.)
 *
 * Durable-window difference (DELIBERATE — the asymmetry is a feature, not a bug):
 *   A counts durable notes by CAPTURE time   (created_at >= cycle.created_at): anything the client
 *     left during this cycle's window suppresses the reminder, relevant to the plan month or not.
 *   B counts durable notes by RELEVANCE to the plan month (relevant_from <= monthEnd AND
 *     relevant_to >= monthStart, plan month = cycle_month + 1) — the SAME window the generator's
 *     loadDurableContext (worker planning.ts) reads, so B is plannable iff generation actually has
 *     something to work with. A note captured this window but NOT relevant to the plan month
 *     therefore suppresses (A) yet is not plannable (B).
 *
 * Orphaned answers: hasIntakeContent counts Object.values(answers) with no reference to the
 * question list (an answer to a since-removed extra still counts). That is intentional here —
 * keying to the list would silently change suppression. The form-completeness question (C) is the
 * one that keys to the list.
 */
import { and, eq, gte, inArray, lte, or, isNull } from 'drizzle-orm';
import { db as _db, planInputs } from '@sprigly/db';
import type { IntakeJson } from './types.js';
import { isEmptyBrief } from './brief-extract.js';

type Db = typeof _db;

/** Durable plan_input types that count as client input. */
export const DURABLE_INPUT_TYPES: string[] = ['idea', 'next_cycle'];

/**
 * Pure: does the cycle's OWN intake carry content (any non-empty answer or free notes)?
 * Question-list agnostic. Reuses isEmptyBrief so "has content" has ONE definition across the
 * suppression path, the planning path, and the admin mirror.
 */
export function hasIntakeContent(intakeJson: IntakeJson | null | undefined): boolean {
  return !isEmptyBrief(intakeJson?.planContent ?? null);
}

export interface SuppressibleCycle { clientId: string; createdAt: Date; intakeJson: unknown; }
export interface PlannableCycle    { clientId: string; cycleMonth: string; intakeJson: unknown; }

/**
 * QUESTION A — suppression. See the file header. Durable window: created_at >= cycle.created_at
 * (a note captured during THIS cycle's window). Short-circuits on intake content (no DB read).
 */
export async function hasSuppressibleInput(db: Db, cycle: SuppressibleCycle): Promise<boolean> {
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

/** "YYYY-MM" → the plan month (cycle_month + 1). */
function planMonthOf(cycleMonth: string): string {
  const [y, m] = cycleMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));   // m is 1-based, so index m == the NEXT month; year rolls
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * QUESTION B — plannable. See the file header. Durable window: relevance overlap with the plan
 * month (mirrors worker planning.ts loadDurableContext, so B tracks what generation consumes).
 * Short-circuits on intake content (no DB read).
 */
export async function hasPlannableInput(db: Db, cycle: PlannableCycle): Promise<boolean> {
  if (hasIntakeContent(cycle.intakeJson as IntakeJson | null)) return true;
  const planMonth  = planMonthOf(cycle.cycleMonth);
  const monthStart = `${planMonth}-01`;
  const monthEnd   = `${planMonth}-31`;   // lexical upper bound for the month
  const rows = await db
    .select({ id: planInputs.id })
    .from(planInputs)
    .where(and(
      eq(planInputs.clientId, cycle.clientId),
      inArray(planInputs.type, DURABLE_INPUT_TYPES),
      eq(planInputs.status, 'active'),
      or(isNull(planInputs.relevantFrom), lte(planInputs.relevantFrom, monthEnd)),
      or(isNull(planInputs.relevantTo),   gte(planInputs.relevantTo,   monthStart)),
    ))
    .limit(1);
  return rows.length > 0;
}
