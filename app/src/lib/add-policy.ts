/**
 * add-policy.ts — may a new post be created on this date?
 *
 * ONE named predicate, so "can I add here?" has a single answer with a single name. The
 * investigation into post-add found the question derived independently in eleven places,
 * disagreeing in ways nobody had decided: the UI enforced one post per day while the server
 * happily created a second, the legacy shell forbade adding to a non-home month while the
 * redesign allowed it, and none of them said so anywhere.
 *
 * ── Why this is its own file rather than living in edit-scope.ts ─────────────
 * edit-scope.ts is the stated home for edit policy and RE-EXPORTS this, so server callers
 * keep importing it from there. But it also imports @sprigly/db, which parses DATABASE_URL
 * at module scope — fine on the server, fatal in the browser. usePlanData.ts is a client
 * component and is one of the sites that must share this predicate, so the pure rule lives
 * in a module with no imports at all and edit-scope re-exports it. One definition, one name,
 * reachable from both sides.
 *
 * Pure. No imports. Directly testable.
 */

/**
 * The policy, now stated rather than implied:
 *   - date must be today or later (the same rule as isEditableDate — editability is by
 *     scheduled_date, per edit-scope's contract)
 *   - NO status check. A cycle in any status accepts adds; POST /api/posts never read
 *     status and the confirmed intent is that it should not start now.
 *   - NO capacity check. A day may hold multiple posts — the planner itself writes two onto
 *     one date and the planning prompt explicitly permits it ("Two beats may legitimately
 *     share a date"). The one-post-per-day cap existed only where the button was drawn.
 *   - postsPerMonthMax stays a target, not a gate.
 *
 * DELIBERATELY NOT the draft-surface policy. Draft-beat adds are additionally guarded by
 * cycleIsPreCutoff (draft-mutations.ts) because an approved month's structure is fixed by
 * contract. Two different surfaces, two different policies; unifying them would be wrong,
 * not tidier.
 *
 * ISO 'YYYY-MM-DD' strings sort lexically, so `>=` is a correct calendar comparison and
 * TODAY ITSELF is addable (the boundary is inclusive).
 */
export function canAddPost(dateIso: string | undefined, today: string): boolean {
  return !!dateIso && dateIso >= today;
}
