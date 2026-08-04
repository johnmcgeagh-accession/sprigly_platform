/**
 * ideas.ts — the client's own sentences, and what became of each.
 *
 * ── What this replaces ───────────────────────────────────────────────────────────────
 *
 * `PlanDesktop`'s Notes view listed `plan_inputs` and stopped there: a column of things the
 * client had said, with no indication that any of them had been acted on. The desktop redesign
 * retired it on the argument that the conversation thread is the record of what was said — which
 * is true, and which left the other half unanswered. A client who says "make Fridays more
 * personal" in July wants to know, in September, whether that ever became anything.
 *
 * So Ideas is Notes' successor with the missing half built: every durable input in the client's
 * own words, each carrying the state the data already knows.
 *
 * ── The state is DERIVED, never stored ───────────────────────────────────────────────
 *
 * `plan_inputs` carries two orthogonal columns and the distinction is load-bearing
 * (schema.ts): `status` is AVAILABILITY (active / integrated / expired / dismissed) and
 * `lifecycle` is MATURITY (candidate → used → measured → proven, plus declined / stale). A
 * 'proven' idea is still 'active', so neither column alone answers "what happened to this?".
 * `ideaState` is that one question, asked of both.
 *
 * Nothing here writes. The one way to add an idea is still to tell the agent, which is the
 * path that already exists and already files it.
 */

/** What became of one input, in the client's terms rather than the schema's. */
export type IdeaState = 'used' | 'waiting' | 'deferred' | 'set-aside';

export interface IdeaRow {
  type: string;
  status: string;
  lifecycle: string;
}

/**
 * The one question, asked of both columns. Order matters:
 *
 *   USED wins over everything. An input that became a post is answered, whatever else is true
 *   of it — including a 'next_cycle' one that got picked up early.
 *   SET ASIDE next, because a declined idea is not "waiting" and saying so would be a promise.
 *   DEFERRED is a TYPE, not a lifecycle: 'next_cycle' is where an input goes when the client
 *   says "not this month", and it is the only state here the client chose themselves.
 *   WAITING is the honest default — on record, not yet used, not turned down.
 */
export function ideaState({ type, status, lifecycle }: IdeaRow): IdeaState {
  if (lifecycle === 'used' || lifecycle === 'measured' || lifecycle === 'proven') return 'used';
  if (status === 'integrated') return 'used';
  if (lifecycle === 'declined' || lifecycle === 'stale') return 'set-aside';
  if (status === 'dismissed' || status === 'expired') return 'set-aside';
  if (type === 'next_cycle') return 'deferred';
  return 'waiting';
}

/**
 * The words beside each state.
 *
 * "Used in August" takes the month when there is one and stays honest when there is not: the
 * cycle that consumed an input is recorded (`used_in_cycle_id`) but it is not guaranteed, and
 * "used in" with nothing after it is worse than "used".
 */
export function ideaStateLabel(state: IdeaState, monthLabel: string | null): string {
  switch (state) {
    case 'used':      return monthLabel ? `Used in ${monthLabel}` : 'Used';
    case 'deferred':  return 'Deferred to next month';
    case 'set-aside': return 'Set aside';
    default:          return 'Waiting';
  }
}

/**
 * A post's headline — its caption's first sentence, capped.
 *
 * THE ONE RULE, in one place. `postTitle` (pieces.tsx) is the plan surface's card title and now
 * calls this; the Ideas reader needs the same string on the server, and a second copy of the
 * rule is how a client ends up seeing an idea "became" a post with a title no card anywhere
 * shows. A post with no caption has no headline yet — the caller decides what to say about that,
 * because "Untitled" is right on a card and wrong in a sentence about what your idea became.
 */
export function postHeadline(caption: string | null | undefined): string | null {
  const cap = (caption ?? '').trim();
  if (!cap || cap.startsWith('Draft idea')) return null;
  return cap.split(/(?<=[.!?])\s/)[0]!.slice(0, 90);
}

/** One input as the surface reads it. Every field is a fact; absent ones are simply absent. */
export interface IdeaView {
  id: string;
  /** Her words, verbatim. This surface never paraphrases them. */
  content: string;
  createdAt: string;
  state: IdeaState;
  /** 'August 2026', when the consuming cycle is on record. */
  usedInMonth: string | null;
  /** WHICH cycle consumed it. The label above is for reading; this is for filtering — the
   *  answerer needs "used in THIS month", and matching on a rendered month name would break
   *  the first time the label's format changed. */
  usedInCycleId: string | null;
  /** The post this became, when a beat recorded the link (`beat_meta.sourceRef`). */
  postId: string | null;
  postTitle: string | null;
}

/** The order the panel shows them in: what is live first, what is finished last, newest within. */
const RANK: Record<IdeaState, number> = { waiting: 0, deferred: 1, used: 2, 'set-aside': 3 };

export function sortIdeas(rows: readonly IdeaView[]): IdeaView[] {
  return [...rows].sort((a, b) =>
    RANK[a.state] - RANK[b.state] || b.createdAt.localeCompare(a.createdAt));
}
