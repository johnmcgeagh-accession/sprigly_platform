/**
 * agent/types.ts — the task-parser-based plan agent contract.
 *
 * EVERY message is parsed by the LLM task parser into an ordered list of tasks.
 * Every mutating task becomes a pending proposal (nothing applies on parse);
 * add_note writes directly; query/clarify resolve inline. There is no regex fast
 * path and no immediate execution.
 */

/** The parser's task actions, in message order. */
export type TaskActionType =
  | 'move_post' | 'delete_post' | 'rewrite_post' | 'add_post' | 'change_format' | 'generate_hook' | 'refine'
  | 'add_note' | 'query' | 'clarify';

/** Mutating actions become proposals. */
export type MutatingAction = 'move_post' | 'delete_post' | 'rewrite_post' | 'add_post' | 'change_format' | 'generate_hook' | 'refine';
export const MUTATING_ACTIONS: readonly MutatingAction[] = ['move_post', 'delete_post', 'rewrite_post', 'add_post', 'change_format', 'generate_hook', 'refine'];

/**
 * A single parsed task. `postId` is set when the parser resolved a reference to
 * exactly one post; `selector` is the raw reference when it didn't (resolved or
 * rejected server-side). `reason` is the user's own phrasing for this task, used
 * verbatim in the proposal summary.
 */
export interface ParsedTask {
  action: TaskActionType;
  postId?: string | null;
  selector?: string | null;
  fromDate?: string | null;      // move_post SOURCE date (ISO) when the post is named by date — the reliable source key
  toDate?: string | null;        // move_post / add_post destination (ISO 'YYYY-MM-DD')
  instruction?: string | null;   // rewrite_post
  channel?: string | null;       // add_post
  format?: string | null;        // change_format / add_post ('reel'|'carousel'|'single')
  target?: string | null;        // refine ('hook'|'script')
  content?: string | null;       // add_note
  targetMonth?: string | null;   // add_note ('YYYY-MM')
  relevantFrom?: string | null;  // add_note (ISO date)
  relevantTo?: string | null;    // add_note (ISO date)
  question?: string | null;      // query / clarify
  reason?: string | null;        // the user's phrasing for this task
}

/** Payload persisted on an agent_proposals row — everything approval needs to
 *  apply deterministically (move/delete/add) or enqueue (rewrite). */
export type ProposalPayload =
  | { kind: 'move';    cycleId: string; postId: string; toDate: string }
  | { kind: 'delete';  cycleId: string; postId: string }
  | { kind: 'rewrite'; cycleId: string; postId: string; instruction: string }
  | { kind: 'format';  cycleId: string; postId: string; format: string }
  | { kind: 'add';     cycleId: string; date: string; channel: string | null; instruction?: string | null; format?: string | null }
  // generate_hook enqueues the existing hook engine job on approve. The target is EITHER an
  // existing reel/carousel (postId set) OR a post created earlier in the SAME ask by an
  // add proposal (refProposalId set, postId null) — resolved at apply time from the ledger
  // (the post_created row tagged with that proposal id). Only valid for reels/carousels.
  | { kind: 'generate_hook'; cycleId: string; postId?: string | null; refProposalId?: string | null }
  // refine enqueues the target-aware shape job (§26) for a HOOK or SCRIPT on approve. postId
  // for an existing post, or refProposalId for one created earlier in the same ask. The field
  // must exist (non-empty) — an empty field blocks gracefully (offer generation instead).
  | { kind: 'refine'; cycleId: string; postId?: string | null; refProposalId?: string | null; target: 'hook' | 'script'; instruction: string }
  // Weekly session — pre-generated content applied deterministically on approve
  // (no second generation). apply_caption carries the full rewritten caption;
  // add_generated carries a whole new validated draft. noteId (when set) is the
  // note this rewrite integrates, marked integrated on approval.
  | { kind: 'apply_caption'; cycleId: string; postId: string; caption: string; noteId?: string | null }
  | { kind: 'add_generated'; cycleId: string; date: string; channel: string; format: string; pillar: string; caption: string };

export const ACTION_TO_KIND: Record<MutatingAction, ProposalPayload['kind']> = {
  move_post: 'move', delete_post: 'delete', rewrite_post: 'rewrite', add_post: 'add', change_format: 'format', generate_hook: 'generate_hook', refine: 'refine',
};

/** The proposal shape returned to the client (list + inline actions). */
export interface ProposalView {
  id: string;
  intent: string;
  summary: string;
  status: string;
  changeSetId: string | null;
}

/** The /api/plan/agent turn response. Mutations never apply here — they arrive as
 *  proposals to review. */
export interface AgentTurnResponse {
  conversationId: string;
  message: string;
  proposals: ProposalView[];
  changeSetId: string | null;
}
