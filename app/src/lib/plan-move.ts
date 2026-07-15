/**
 * plan-move.ts — pure guards for the optimistic drag/swipe reschedule (FIX 2), factored out of
 * usePlanData so the race-safety rules are unit-testable without a DOM.
 */
import type { PlanPost } from './types';

/**
 * Decide whether a reschedule drop is accepted, and capture the post's current date (to snap back
 * to on failure). Returns null — a no-op — when:
 *  - the surface is read-only,
 *  - the card is ALREADY reconciling a move (pending): a second drag on the SAME card is blocked so
 *    rapid successive drags can never double-apply or lose a move (different cards are independent),
 *  - the card isn't found, or it was dropped back onto its own day.
 */
export function planMoveGuard(
  id: string,
  toDate: string,
  posts: Pick<PlanPost, 'id' | 'date'>[],
  pending: Set<string>,
  readOnly: boolean,
): { prevDate: string } | null {
  if (readOnly) return null;
  if (pending.has(id)) return null;
  const post = posts.find((p) => p.id === id);
  if (!post || post.date === toDate) return null;
  return { prevDate: post.date };
}

/**
 * After one optimistic move settles, reconcile with the server (refetch) ONLY when it succeeded AND
 * no other move is still pending — so an early refetch can't clobber a concurrent card's optimistic
 * move. (The refetch also resolves the date-authoritative cross-month cases: a card whose new date
 * left the viewed month drops out of the grid and resurfaces in its cycle / the "outside" strip.)
 */
export function shouldReconcile(ok: boolean, pendingAfterSettle: Set<string>): boolean {
  return ok && pendingAfterSettle.size === 0;
}
