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
 *   B counts durable notes by RELEVANCE to the plan month (relevance overlap, plan month =
 *     cycle_month + 1) via the SHARED loadDurableInputs — the SAME query the generator's
 *     loadDurableContext (worker planning.ts) now calls, so B is plannable iff generation actually
 *     has something to work with (not "should mirror" — one query, two callers). A note captured
 *     this window but NOT relevant to the plan month therefore suppresses (A) yet is not
 *     plannable (B).
 *
 * Orphaned answers: hasIntakeContent counts Object.values(answers) with no reference to the
 * question list (an answer to a since-removed extra still counts). That is intentional here —
 * keying to the list would silently change suppression. The form-completeness question (C) is the
 * one that keys to the list.
 */
import { and, eq, gte, inArray, lt, or, isNull } from 'drizzle-orm';
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
 * "YYYY-MM" → the FIRST day of the FOLLOWING month, "YYYY-MM-01". This is the strict upper bound
 * for a plan-month relevance window: `relevant_from < firstOfMonthAfter(planMonth)` selects every
 * date in (and before) the plan month with NO invalid-date literal — no `-31`/`-30`, no February
 * special case, no last-day arithmetic. The old `${planMonth}-31` lexical bound threw
 * `date/time field value out of range` against the DATE columns for every <31-day plan month
 * (Sep/Apr/Jun/Nov → -31 invalid, Feb → -31 invalid).
 */
function firstOfMonthAfter(planMonth: string): string {
  const [y, m] = planMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m!, 1));   // m 1-based → index m == the month AFTER planMonth; year rolls
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export interface DurableInputRow {
  /** plan_inputs.id. Carried so a beat built from this row can point AT the row. */
  id:        string;
  type:      string;
  content:   string;
  /**
   * MATURITY — 'candidate' | 'used' | 'measured' | 'proven' | 'declined' | 'stale'.
   * Orthogonal to `status` (availability), which the WHERE clause already pins to 'active'.
   * Selected, never filtered on: see the note on the query below.
   */
  lifecycle: string;
  /** plan_inputs.created_at as 'YYYY-MM-DD'. When she gave us the idea — the sheet says
   *  "From what you told us in June" and this is the only thing that can date it. */
  createdAt: string;
}

/**
 * THE one durable relevance-window query — active plan_inputs of type idea|next_cycle whose
 * relevance window overlaps `planMonth` (null bounds are open):
 *   relevant_from <  first-of-month-after(planMonth)   — starts on/before the plan month
 *   relevant_to   >= first-of(planMonth)               — ends   on/after  the plan month
 * SHARED verbatim by the planning GATE (hasPlannableInput — "is there anything?") and the
 * generator's loadDurableContext (worker planning.ts — "give me the rows"), so the two can never
 * diverge on the window again. Returns the rows; each caller decides existence vs content and
 * keeps its OWN error posture (the generator wraps this best-effort → []; the gate lets errors
 * propagate). The window is identical to the prior two inline copies except the fixed upper bound.
 *
 * `id`, `lifecycle` and `createdAt` are SELECTED but the WHERE clause is untouched, deliberately. The draft
 * assembler wants to rank a never-used idea above one that has already run, and to refuse a
 * declined one outright — but doing that here would change what "is there anything plannable?"
 * means for the gate and the app's intake route, which share this query precisely so the answer
 * cannot come to differ between them. Selection is additive; a predicate would not be. The
 * ranking policy therefore lives with the caller that has one (draft-plan.ts).
 */
export async function loadDurableInputs(db: Db, clientId: string, planMonth: string): Promise<DurableInputRow[]> {
  const monthStart     = `${planMonth}-01`;
  const nextMonthStart = firstOfMonthAfter(planMonth);
  const rows = await db
    .select({
      id: planInputs.id, type: planInputs.type, content: planInputs.content,
      lifecycle: planInputs.lifecycle, createdAt: planInputs.createdAt,
    })
    .from(planInputs)
    .where(and(
      eq(planInputs.clientId, clientId),
      inArray(planInputs.type, DURABLE_INPUT_TYPES),
      eq(planInputs.status, 'active'),
      or(isNull(planInputs.relevantFrom), lt(planInputs.relevantFrom, nextMonthStart)),
      or(isNull(planInputs.relevantTo),   gte(planInputs.relevantTo,   monthStart)),
    ));
  return rows.map((r) => ({
    id: r.id, type: r.type, content: r.content, lifecycle: r.lifecycle,
    createdAt: r.createdAt.toISOString().slice(0, 10),
  }));
}

/**
 * QUESTION B — plannable. See the file header. Durable window: the SHARED loadDurableInputs (the
 * SAME query the generator consumes), so B is plannable iff generation actually has something to
 * work with. Short-circuits on intake content (no DB read).
 */
export async function hasPlannableInput(db: Db, cycle: PlannableCycle): Promise<boolean> {
  if (hasIntakeContent(cycle.intakeJson as IntakeJson | null)) return true;
  const rows = await loadDurableInputs(db, cycle.clientId, planMonthOf(cycle.cycleMonth));
  return rows.length > 0;
}
