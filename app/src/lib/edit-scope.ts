/**
 * edit-scope.ts — DATE-based editability (policy: editability is by scheduled_date,
 * not by which cycle the token is homed on). Any post/task belonging to the token's
 * OWN CLIENT is editable iff its scheduled_date >= today (Europe/London). Anything
 * dated before today is read-only. The per-cycle token remains the access credential
 * (client identity + auth); it no longer decides which cycle is editable.
 *
 * "today" is ALWAYS computed server-side (London midnight) — never the client clock —
 * and is injectable into the pure gate so unit tests can pin the boundary. Every write
 * path funnels its date check through here so the rule is defined in one place.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, contentCyclePosts } from '@sprigly/db';
import { resolveTodayIso } from './steps';

/** London 'today' as 'YYYY-MM-DD' (honours the non-prod e2e freeze via resolveTodayIso). */
export function editScopeToday(): string {
  return resolveTodayIso('Europe/London');
}

/**
 * The rule, pure and testable: a date is editable iff it is today or later in London.
 * ISO 'YYYY-MM-DD' strings sort lexically, so `>=` is a correct calendar comparison and
 * TODAY ITSELF is editable (boundary is inclusive).
 */
export function isEditableDate(scheduledDate: string, today: string = editScopeToday()): boolean {
  return scheduledDate >= today;
}

export interface PostEditContext {
  cycleId:       string;
  scheduledDate: string;   // 'YYYY-MM-DD'
  channel:       string;
}

/**
 * Resolve a live post by (client, id) across ANY of the client's cycles — the cross-month
 * lookup the date policy needs (the token's cycle no longer scopes the write). Returns the
 * post's real cycle + date so the caller can gate by date and target the correct cycle.
 * Null if the id isn't this client's, or is soft-deleted.
 */
export async function resolvePostForEdit(clientId: string, postId: string): Promise<PostEditContext | null> {
  const [row] = await db
    .select({
      cycleId:       contentCyclePosts.cycleId,
      scheduledDate: contentCyclePosts.scheduledDate,
      channel:       contentCyclePosts.channel,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.id, postId),
      eq(contentCyclePosts.clientId, clientId),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);
  return row ?? null;
}

export type EditGate =
  | ({ ok: true } & PostEditContext)
  | { ok: false; status: 404 | 403; error: 'not_found' | 'read_only' };

/**
 * The route-level gate: resolve the post for this client, then apply the date rule.
 * 404 if the post isn't the client's (never leak another client's ids); 403 'read_only'
 * if it's dated before today. On success returns the post's real cycleId so the route can
 * pass it to the (unchanged) mutation/enqueue helpers and hit the correct cycle.
 */
export async function gatePostEdit(clientId: string, postId: string, today: string = editScopeToday()): Promise<EditGate> {
  const ctx = await resolvePostForEdit(clientId, postId);
  if (!ctx) return { ok: false, status: 404, error: 'not_found' };
  if (!isEditableDate(ctx.scheduledDate, today)) return { ok: false, status: 403, error: 'read_only' };
  return { ok: true, ...ctx };
}
