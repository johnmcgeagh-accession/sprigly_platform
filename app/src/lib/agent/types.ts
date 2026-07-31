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
  /**
   * THIS TASK AMENDS THE PENDING PROPOSAL rather than standing beside it (C3).
   *
   * Set by the parser when the utterance corrects something the client has NOT yet applied —
   * "instead of a single image make it a reel" while an add is still sitting there unresolved.
   * The turn then SUPERSEDES that proposal: the old one is rejected, a new one is created
   * carrying the amendment, and the sheet marks the old turn superseded and renders the new
   * interpretation. Without this the two would sit side by side and the client would apply
   * both — an add they did not want and an add they did.
   */
  amends?: boolean | null;
  /**
   * THE CHANGE BEING ASSEMBLED ACROSS TURNS (G1). Set on a `clarify` that asks for a missing
   * slot, and carried forward until the intent resolves into a real action. See `PendingIntent`.
   */
  intent?: PendingIntent | null;
}

/**
 * ── A PENDING INTENT: A QUESTION WITH SOMEWHERE FOR THE ANSWER TO GO ─────────────────
 *
 * The raspberry launch, from the operator's screenshots:
 *
 *     CLIENT     I want to launch the raspberry set
 *     ASSISTANT  Is it new, or an existing one coming back?
 *     CLIENT     It's new. Angle is fresh, new-in.
 *     ASSISTANT  What format were you thinking?
 *     CLIENT     Reels
 *     ASSISTANT  What would you like to do with the reels?
 *
 * The last line is the failure, and it is not a failure of understanding — it is a failure of
 * STATE. Every turn was parsed on its own. "Reels" arrived as a complete utterance with no
 * verb, no subject and no target, so the only reading available was "the client has said the
 * word reels", and the only safe response to that is to ask what they mean. The launch that
 * three turns had been assembling did not exist anywhere: not in the digest (nothing had been
 * created), not in the pending proposals (nothing had been proposed), and not in the thread in
 * any form an answer could attach to — the question turn serialised as
 * `could not do: <question>` (`conversation.ts`), which reads to a model as an ask that was
 * DROPPED rather than one that is OPEN.
 *
 * So the ask itself becomes an object. A pending intent is the change being built: which action
 * it will be, which slots are filled, and the question the last turn asked. It rides in the
 * parser's context every turn, answers MERGE into it, and it resolves into an interpretation
 * the moment it has enough — at which point it is gone. Only an utterance that plainly names
 * something else breaks out of it.
 *
 * It is deliberately NOT a proposal. A proposal is a change the client can apply; an intent is
 * a change we are still writing down, and offering Apply on a half-built one would be offering
 * consent to something nobody has stated yet.
 */
export interface PendingIntent {
  /** What this will become when it resolves. */
  action: MutatingAction;
  /**
   * What has been said so far. Every slot optional — assembly is incremental by definition, and
   * a slot that is absent is a slot nobody has mentioned, which is different from an empty one.
   */
  slots: {
    /** What the post is about — the product, drop, or event. */
    subject?: string | null;
    /** ISO 'YYYY-MM-DD' once resolved; the client's own phrase until then. */
    date?: string | null;
    format?: string | null;
    /** How many posts the client wants. A launch is usually several. */
    count?: number | null;
    /** The take: "fresh, new-in", "back by demand". */
    angle?: string | null;
  };
  /** The question the assistant asked on the turn that carried this. What the next utterance
   *  is read as an answer to. */
  question?: string | null;
  /** Which slots have already been asked about. A slot is asked about ONCE — a second ask is
   *  the interrogation the client walks away from, so an unanswered slot is defaulted instead. */
  asked?: string[];
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

/**
 * The status a guard leaves on a refused proposal.
 *
 * Named here rather than written twice because BOTH sides read it: `approveProposal` sets it,
 * and the plan surface checks for it when deciding whether an apply actually applied (G3). It
 * also keeps the literal out of `src/components/plan`, where the terminology fence — rightly —
 * refuses to excuse a bare "failed" as an identifier.
 */
export const PROPOSAL_REFUSED = 'failed';

/** The proposal shape returned to the client (list + inline actions). */
export interface ProposalView {
  id: string;
  intent: string;
  summary: string;
  status: string;
  changeSetId: string | null;
}

/**
 * ── THE INTERPRETATION ───────────────────────────────────────────────────────────────
 *
 * What the client is actually consenting to when they tap Apply.
 *
 * Not the transcript. The transcript is what they said; it tells them nothing they do not
 * already know, and echoing it back asks them to check our hearing rather than our understanding.
 * Not the raw intent either — `{action:'move_post', postId:'…', toDate:'2026-08-12'}` is a fact
 * about our datastore, not about their plan.
 *
 * The consent object is the INTERPRETATION: the concrete changes, with every reference resolved.
 * "Move 'Fragrance Note Deep Dive: Summer' → Wed 12 Aug" is checkable at a glance in a way that
 * neither of the other two is.
 *
 * ── The derivation rule ──────────────────────────────────────────────────────────────
 *
 * Every field below is COMPUTED — from the structured task the parser extracted, and from the
 * post row it resolved to. Nothing here is a sentence the model wrote. This is the
 * rationale-evidence rule applied to consent: if the client approves prose, they have approved
 * a claim about what will happen; if they approve a resolved title and a resolved date, they
 * have approved the thing itself.
 *
 * That is why `title` is the post's own title and never `task.reason` — `reason` is the model's
 * paraphrase of their phrasing, which is exactly the transcript-echo this replaces.
 *
 * The surface renders these. It formats the dates itself, because date rendering is a property
 * of the surface and not of the agent.
 */
export type InterpretedItem =
  | {
      kind: 'change';
      /** The proposal this line will apply. Per-item discard needs it too. */
      proposalId: string;
      action: 'move' | 'add' | 'remove' | 'rewrite' | 'format' | 'hook' | 'refine';
      /** The RESOLVED post title, or the subject of the post being added. Null when adding a
       *  post with no stated subject — the line then names the format and the date only. */
      title: string | null;
      /** ISO 'YYYY-MM-DD'. Resolved, never relative, never a phrase. */
      fromDate?: string | null;
      toDate?: string | null;
      format?: string | null;
      target?: 'hook' | 'script' | null;
    }
  /** Filed rather than placed. The honest state the intake receipts already use. */
  | { kind: 'idea'; text: string }
  /** The extractor could not resolve it. Carries the real question, and applies nothing. */
  | { kind: 'unresolved'; question: string };

/** The /api/plan/agent turn response. Mutations never apply here — they arrive as
 *  proposals to review. */
export interface AgentTurnResponse {
  conversationId: string;
  message: string;
  proposals: ProposalView[];
  /** The interpretation, itemised. One entry per thing the client asked for, in the order they
   *  asked. Empty only when the turn was a pure query. */
  items: InterpretedItem[];
  changeSetId: string | null;
  /** Pending proposals this turn AMENDED and therefore rejected (C3). The sheet marks those
   *  turns superseded and stops offering their Apply — two versions of one change must never
   *  both be applicable. */
  supersededProposalIds?: string[];
}
