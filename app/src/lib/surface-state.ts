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
 *  4. Otherwise the committed shell, which renders its own empty state.
 */
export function resolveSurfaceKind(facts: SurfaceFacts): SurfaceKind {
  if (!facts.hasSession) return 'gated';
  if (facts.committedPostCount === 0 && facts.draftBeatCount > 0) return 'draft';
  return facts.planRedesign ? 'committed-redesign' : 'committed-legacy';
}

/** True when the page needs to spend a query loading draft beats at all. Lets the page
 *  stay lazy — most loads are committed cycles and should not pay for a draft read. */
export function mayHaveDraftSurface(facts: Pick<SurfaceFacts, 'hasSession' | 'committedPostCount'>): boolean {
  return facts.hasSession && facts.committedPostCount === 0;
}
