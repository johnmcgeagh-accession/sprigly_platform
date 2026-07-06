/**
 * agent/types.ts — the proposal-based plan agent contract (commit 2).
 *
 * Kept separate from the top-level lib/types.ts so the agent surface can evolve
 * without churn to the plan-render/switcher types.
 */

/** The eight intents the LLM router classifies into. */
export type RouterIntent =
  | 'note_for_month'
  | 'idea_backlog'
  | 'next_cycle_input'
  | 'structural'
  | 'add'
  | 'rewrite'
  | 'query'
  | 'clarify';

/** Capture intents create a proposal instead of touching any content table. */
export type CaptureIntent = 'note_for_month' | 'idea_backlog' | 'next_cycle_input';

export const CAPTURE_INTENTS: readonly CaptureIntent[] = ['note_for_month', 'idea_backlog', 'next_cycle_input'];

/** The router's structured output. `content` is the cleaned instruction/text. */
export interface RouterResult {
  intent: RouterIntent;
  content: string;
  targetMonth?: string | null;   // 'YYYY-MM' when the client named one
  channel?: string | null;       // 'instagram' | 'email' when named
}

/** plan_inputs.type — the deterministic apply target for each capture intent. */
export type PlanInputType = 'note' | 'idea' | 'next_cycle';

export const CAPTURE_TO_INPUT: Record<CaptureIntent, PlanInputType> = {
  note_for_month: 'note',
  idea_backlog: 'idea',
  next_cycle_input: 'next_cycle',
};

/** Payload persisted on an agent_proposals row — everything apply needs, so apply
 *  is a pure deterministic INSERT with no re-derivation. */
export interface ProposalPayload {
  type: PlanInputType;
  content: string;
  cycleId: string | null;
  targetMonth?: string | null;
  channel?: string | null;
}

/** The proposal shape returned to the client (list + inline actions). */
export interface ProposalView {
  id: string;
  intent: string;
  summary: string;
  status: string;
}

/** The /api/plan/agent response envelope for a single turn. */
export interface AgentTurnResponse {
  conversationId: string;
  message: string;              // the assistant's reply text
  proposals: ProposalView[];    // proposals created this turn (empty for most turns)
  // Action turns (structural/add/rewrite) additionally carry the existing seam
  // fields so the plan UI updates in place exactly as before.
  applied?: { changedPostIds: string[] };
  pendingJobIds?: string[];
}
