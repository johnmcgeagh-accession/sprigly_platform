/**
 * surface-state.ts — which surface does this client see?
 *
 * ONE derivation, in one place, as a discriminated union. Before this, page.tsx made the
 * decision through four stacked early returns; by Build B that was four, and Build C and D
 * each add more states. Stacked `if`s do not compose: each new branch has to be read
 * against every branch above it to know when it fires.
 *
 * So the rule is: **new states join the union, they do not become new forks in the page.**
 * The page loads data, calls this once, and switch-renders the answer.
 *
 * Pure. No db, no React. The page still owns its queries — this owns only the decision.
 */

/** Every surface the client app can land on. Extend the union, not the page. */
export type SurfaceKind =
  | 'gated'                // no session — the magic-link explainer
  | 'draft'                // an unapproved draft month to react to (Build B)
  | 'committed-redesign'   // the committed plan, redesign shell (plan_redesign flag on)
  | 'committed-empty'      // the redesign shell over a month with nothing in it yet
  | 'committed-legacy';    // the committed plan, original shell

export interface SurfaceFacts {
  hasSession:         boolean;
  /** Live, draft-FENCED post count. Non-zero means committed work exists. */
  committedPostCount: number;
  /** Draft beats on the landed cycle. Only meaningful when committedPostCount is 0. */
  draftBeatCount:     number;
  planRedesign:       boolean;
}

/**
 * Resolve the surface.
 *
 * Order is load-bearing and each step is a rule, not an accident:
 *
 *  1. No session → gated. Nothing else can be true.
 *  2. Committed posts exist → the committed plan wins, ALWAYS. This is the mixed-state
 *     rule from Build B: a cycle holding both committed posts and leftover drafts (the
 *     known interim state until Build D owns supersession) renders the plan, and the
 *     drafts stay invisible exactly as they are to every other reader. Testing
 *     `committedPostCount === 0` rather than "are any rows drafts?" is what keeps that
 *     honest — the count comes from the already-fenced list, so the two cannot drift.
 *  3. No committed posts but drafts exist → the draft surface.
 *  4. No committed posts and no drafts → the redesign shell, told that the month is EMPTY.
 *  5. Otherwise the committed shell.
 *
 * ── WHY 4 IS A MEMBER OF THIS UNION AND NOT A COUNT READ SOMEWHERE ELSE ──────────────
 *
 * The empty month was already handled here — step 4 used to be a comment saying "the
 * committed shell renders its own empty state", and it does: the grid says "Nothing planned
 * across September yet" and the rail says "0 posts this month", each from its own count. What
 * never reached the composer was the fact itself, so its framing stayed the constant
 * `context="committed"` and the agent's opening turn said "September is written" over a month
 * with nothing in it.
 *
 * The cheap fix is for the surface to branch on a post count it happens to be holding. That
 * would make four independent derivations of "what state is this month in" on one screen —
 * two counts, a literal, and the cycle status the intake banner reads. So the fact joins the
 * union instead, where the counts already are, and every consumer reads the same answer.
 *
 * LEGACY IS DECIDED FIRST. The original shell has no composer and no empty framing, so there
 * is nothing for this state to change there; a flag-off tenant's empty month is
 * 'committed-legacy' exactly as before.
 */
export function resolveSurfaceKind(facts: SurfaceFacts): SurfaceKind {
  if (!facts.hasSession) return 'gated';
  if (facts.committedPostCount === 0 && facts.draftBeatCount > 0) return 'draft';
  if (!facts.planRedesign) return 'committed-legacy';
  return facts.committedPostCount === 0 ? 'committed-empty' : 'committed-redesign';
}

/**
 * Which framing the conversation composer opens with, for a surface.
 *
 * The mapping lives HERE, beside the union, rather than as a ternary at the call site — so
 * adding a member to `SurfaceKind` is one edit with one place to check, and so the projection
 * is assertable without rendering anything.
 *
 * 'gated' and 'draft' never reach it: the gate renders no composer, and the draft surface
 * passes its own context. They map to 'committed' as the safe default for the same reason
 * `followServerSurface` defaults that way — a wrong framing on a written month is a smaller
 * error than an "add me something" invitation over a month full of posts.
 */
export function voiceContextFor(kind: SurfaceKind): 'committed' | 'empty' {
  return kind === 'committed-empty' ? 'empty' : 'committed';
}

/** True when the page needs to spend a query loading draft beats at all. Lets the page
 *  stay lazy — most loads are committed cycles and should not pay for a draft read. */
export function mayHaveDraftSurface(facts: Pick<SurfaceFacts, 'hasSession' | 'committedPostCount'>): boolean {
  return facts.hasSession && facts.committedPostCount === 0;
}

/**
 * What the client should hold after entering a cycle, given the server's answer for it.
 *
 * The client FOLLOWS; it does not decide. This exists so that rule is a named, testable
 * thing rather than an `if` buried in a fetch handler, and so "drop the draft when leaving
 * a draft month" cannot be forgotten — a stale draft rendering over a committed month
 * would be the same class of bug as the one this build fixes, pointing the other way.
 *
 * An absent kind means an older server (or a failed field); defaulting to the committed
 * shell is the safe direction — it shows real plan rows rather than an empty draft frame.
 */
export function followServerSurface(serverKind: SurfaceKind | undefined): {
  kind: SurfaceKind;
  loadDraft: boolean;
} {
  const kind = serverKind ?? 'committed-redesign';
  return { kind, loadDraft: kind === 'draft' };
}
