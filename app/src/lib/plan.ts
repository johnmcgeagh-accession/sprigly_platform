/**
 * plan.ts — server-side plan reads. Loads content_cycle_posts for a cycle and maps
 * them to the PlanPost contract. All access is scoped by the caller's session
 * (clientId + cycleId), never by client-supplied ids.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db, contentCyclePosts } from '@sprigly/db';
import type { PlanPost, PostChannel, PostFormat, PostStatus } from './types.js';

const FORMATS = new Set<PostFormat>(['reel', 'carousel', 'single', 'email']);
const STATUSES = new Set<PostStatus>(['planned', 'edited', 'new']);

/** Load the plan posts for a cycle, ordered by position then date. Scoped to the
 *  session's client+cycle — pass both so a token can only ever read its own plan. */
export async function loadPlanPosts(clientId: string, cycleId: string): Promise<PlanPost[]> {
  const rows = await db
    .select()
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.cycleId, cycleId), eq(contentCyclePosts.clientId, clientId)))
    .orderBy(asc(contentCyclePosts.position), asc(contentCyclePosts.scheduledDate));

  return rows.map((r) => ({
    id:       r.id,
    cycleId:  r.cycleId,
    clientId: r.clientId,
    channel:  (r.channel === 'email' ? 'email' : 'instagram') as PostChannel,
    date:     r.scheduledDate,                                   // already 'YYYY-MM-DD'
    format:   (FORMATS.has(r.format as PostFormat) ? r.format : 'single') as PostFormat,
    pillar:   r.pillar ?? '',
    caption:  r.caption ?? '',
    status:   (STATUSES.has(r.status as PostStatus) ? r.status : 'planned') as PostStatus,
    script:   r.script ?? null,
    overlay:  r.overlay ?? null,
  }));
}
