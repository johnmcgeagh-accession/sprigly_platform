/**
 * telemetry.ts — best-effort product analytics for the plan surface (Stage 5).
 * Writes to ui_events, which is deliberately NOT plan_activity: plan_activity is the
 * plan-mutation ledger (source of truth); ui_events is analytics. Failures are swallowed.
 */
import { db, uiEvents } from '@sprigly/db';

/**
 * The client asked for more AI changes this month (X2d).
 *
 * Named as a constant because two places quote it — the route that writes it and the operator's
 * own query — and an event name typed twice is an event name that eventually differs. It is the
 * only entry here that anyone will ever run a business query against, which is why it says so.
 */
export const AI_CHANGE_UPSELL_INTEREST = 'ai_change_upsell_interest';

export const UI_EVENTS = [
  'view_switched',
  'proposal_approved',
  'proposal_discarded',
  'agent_ask_submitted',
  'checklist_step_completed',
  'shape_requested',
  AI_CHANGE_UPSELL_INTEREST,
] as const;
export type UiEvent = (typeof UI_EVENTS)[number];

export async function recordUiEvent(clientId: string, event: string, payload?: Record<string, unknown>): Promise<void> {
  try {
    await db.insert(uiEvents).values({ clientId, event, payload: payload ?? null });
  } catch { /* telemetry is best-effort — never fail a request over it */ }
}
