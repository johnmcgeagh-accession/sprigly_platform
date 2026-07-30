/**
 * plan-changes.ts — what changed on a cycle recently, read from the EXISTING ledger.
 *
 * The what-changed visibility work (conversation-sheet session) needs two things the committed
 * surface could not answer: which DAYS hold posts changed since the client last looked, and a
 * list of recent receipts to read. Both are already recorded — every mutation writes a
 * plan_activity row (activity.ts) — so this is a read, not a new ledger.
 *
 * Only CLIENT-LEGIBLE actions are receipts: a step tick or a checklist generation is activity,
 * not a change to what the month says. The post is joined for its date and title; a change to a
 * since-deleted post keeps its row (post_id survives soft delete) and reports the post's last
 * known date, so a removal is still locatable on the calendar.
 */
import { and, desc, eq, gt, inArray, isNotNull } from 'drizzle-orm';
import { db, planActivity, contentCyclePosts } from '@sprigly/db';
import { postTitle } from './agent/selectors';

/** The actions a client would call "something changed on my plan". */
export const RECEIPT_ACTIONS = [
  'post_created', 'rescheduled', 'caption_saved', 'hook_saved', 'script_saved',
  'format_changed', 'post_deleted', 'post_reverted',
] as const;

export interface PlanChangeView {
  id: string;
  action: string;
  postId: string | null;
  /** The day the change lands on: a move's DESTINATION, else the post's scheduled date. */
  date: string | null;
  /** The post's own title (caption first line, else pillar) — resolved, never narrated. */
  title: string | null;
  at: string;
  origin: string;
}

/** Recent receipt-worthy changes for a cycle, newest first. `sinceIso` bounds the window
 *  (null → the most recent `limit` regardless). Client-scoped. */
export async function loadRecentChanges(
  clientId: string, cycleId: string, sinceIso: string | null, limit = 30,
): Promise<PlanChangeView[]> {
  const since = sinceIso ? new Date(sinceIso) : null;
  const rows = await db
    .select({
      id: planActivity.id, action: planActivity.action, postId: planActivity.postId,
      payload: planActivity.payload, at: planActivity.createdAt, origin: planActivity.origin,
      scheduledDate: contentCyclePosts.scheduledDate,
      caption: contentCyclePosts.caption, pillar: contentCyclePosts.pillar,
    })
    .from(planActivity)
    .leftJoin(contentCyclePosts, eq(planActivity.postId, contentCyclePosts.id))
    .where(and(
      eq(planActivity.clientId, clientId),
      eq(planActivity.cycleId, cycleId),
      inArray(planActivity.action, [...RECEIPT_ACTIONS]),
      isNotNull(planActivity.postId),
      ...(since && !Number.isNaN(since.getTime()) ? [gt(planActivity.createdAt, since)] : []),
    ))
    .orderBy(desc(planActivity.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    // A move's receipt belongs to where the post WENT — that is the day that changed most.
    const to = typeof payload['to'] === 'string' ? (payload['to'] as string) : null;
    return {
      id: r.id,
      action: r.action,
      postId: r.postId,
      date: to ?? r.scheduledDate ?? null,
      title: r.caption !== null || r.pillar !== null ? postTitle({ caption: r.caption ?? '', pillar: r.pillar ?? '' }) : null,
      at: r.at.toISOString(),
      origin: r.origin,
    };
  });
}
