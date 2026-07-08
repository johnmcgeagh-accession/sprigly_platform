/**
 * telemetry.ts — best-effort product analytics for the plan surface (Stage 5).
 * Writes to ui_events, which is deliberately NOT plan_activity: plan_activity is the
 * plan-mutation ledger (source of truth); ui_events is analytics. Failures are swallowed.
 */
import { db, uiEvents } from '@sprigly/db';

export const UI_EVENTS = [
  'view_switched',
  'proposal_approved',
  'proposal_discarded',
  'agent_ask_submitted',
  'checklist_step_completed',
  'shape_requested',
] as const;
export type UiEvent = (typeof UI_EVENTS)[number];

export async function recordUiEvent(clientId: string, event: string, payload?: Record<string, unknown>): Promise<void> {
  try {
    await db.insert(uiEvents).values({ clientId, event, payload: payload ?? null });
  } catch { /* telemetry is best-effort — never fail a request over it */ }
}
