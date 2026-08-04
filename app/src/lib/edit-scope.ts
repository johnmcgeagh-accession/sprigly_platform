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
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, contentCycles, contentCyclePosts, POST_STATUS_DRAFT } from '@sprigly/db';
import { resolveTodayIso } from './steps';
import { nextMonth } from './cycle-nav';

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

/**
 * May a new post be created on this date? (Committed-plan surface.)
 *
 * Re-exported so edit-scope stays the one place server callers look for edit policy. The
 * rule itself lives in add-policy.ts because this module imports @sprigly/db (fatal in the
 * browser) and the client-side plan surface must share the same predicate. See add-policy.ts
 * for the policy and why it deliberately differs from the draft surface's.
 */
export { canAddPost } from './add-policy';

export interface PostEditContext {
  cycleId:       string;
  scheduledDate: string;   // 'YYYY-MM-DD'
  channel:       string;
  /** The row's own status. Carried so the gate below can refuse a DRAFT beat — see
   *  `gatePostEdit`. Every caller already had the id; none of them had this fact. */
  status:        string;
}

/**
 * Resolve a live post by (client, id) across ANY of the client's cycles — the cross-month
 * lookup the date policy needs (the token's cycle no longer scopes the write). Returns the
 * post's real cycle + date so the caller can gate by date and target the correct cycle.
 * Null if the id isn't this client's, or is soft-deleted.
 *
 * Deliberately still returns DRAFT rows. This is the resolver, not the gate: `steps/route.ts`
 * calls it to read a post's cycle, and a lookup that lied about existence would be a worse
 * primitive than one that reports the status and lets `gatePostEdit` decide.
 */
export async function resolvePostForEdit(clientId: string, postId: string): Promise<PostEditContext | null> {
  const [row] = await db
    .select({
      cycleId:       contentCyclePosts.cycleId,
      scheduledDate: contentCyclePosts.scheduledDate,
      channel:       contentCyclePosts.channel,
      status:        contentCyclePosts.status,
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
  | { ok: false; status: 404 | 403 | 409; error: 'not_found' | 'read_only' | 'draft_row' };

/**
 * The route-level gate: resolve the post for this client, then apply the date rule.
 * 404 if the post isn't the client's (never leak another client's ids); 403 'read_only'
 * if it's dated before today. On success returns the post's real cycleId so the route can
 * pass it to the (unchanged) mutation/enqueue helpers and hit the correct cycle.
 *
 * ── AND 409 'draft_row' FOR AN UNAPPROVED BEAT ───────────────────────────────────────
 *
 * This resolved by (client, id) with NO status condition, and eleven routes gate on it:
 * PATCH/DELETE /api/posts/:id, revert, shape, retry-generation, steps, steps/:stepId,
 * checklist/generate, checklist/regenerate, /api/plan/shape, /api/plan/script,
 * /api/plan/hooks. Every one of them therefore accepted a DRAFT BEAT id — which the client
 * holds, because the draft surface renders those ids, and which the agent's own digest
 * prints. `patchPost` would then stamp `status: 'edited'` on it, i.e. convert an unapproved
 * slot into a committed post; `enqueueShape` would write a caption onto one; `softDeletePost`
 * would tombstone one behind the hard-delete/restore contract `draft-mutations.ts` owns.
 *
 * A draft beat's only write path is `draft-mutations.ts` (behind `requireDraftMutable`) and
 * `draft-apply.ts` (behind `cycleIsPreCutoff`). Neither goes through here, so refusing costs
 * no legitimate caller anything.
 *
 * 409, not 403: the row exists and is the client's, it is simply in a state this door does
 * not serve — the same reading `draft-mutations.ts` gives `not_a_draft`, pointed the other way.
 */
export async function gatePostEdit(clientId: string, postId: string, today: string = editScopeToday()): Promise<EditGate> {
  const ctx = await resolvePostForEdit(clientId, postId);
  if (!ctx) return { ok: false, status: 404, error: 'not_found' };
  if (ctx.status === POST_STATUS_DRAFT) return { ok: false, status: 409, error: 'draft_row' };
  if (!isEditableDate(ctx.scheduledDate, today)) return { ok: false, status: 403, error: 'read_only' };
  return { ok: true, ...ctx };
}

/**
 * ── WHICH OF THIS CLIENT'S CYCLES ARE IN DRAFT ───────────────────────────────────────
 *
 * "In draft" is not "holds a draft row". It is the surface's own rule, and it has to be,
 * because the harm this guards is a surface flip: `resolveSurfaceKind` (surface-state.ts)
 * returns 'draft' iff `committedPostCount === 0 && draftBeatCount > 0`. A MIXED cycle —
 * committed posts plus leftover drafts, the known interim state until Build D owns
 * supersession — already renders as committed, so an ordinary write there is the correct
 * path and must keep working. Refusing on "has any draft row" would break it.
 *
 * So the predicate is stated as the surface states it, from the same two counts, over the
 * same fence (`status='draft'` vs everything else, live rows only). One query for the whole
 * client, because the two questions below are asked of different cycles on the same request
 * and a second query could disagree with the first.
 *
 * Keyed BOTH ways because there are two harms and they need different keys: an INSERT names
 * a cycle, and a DATE MOVE names a month. `nextMonth` is the one definition of a cycle's plan
 * month (`cycle-nav.ts`, pure) — never derived from post dates, so a cross-month-moved post
 * cannot relabel a cycle.
 */
export interface DraftCycles {
  /** Cycle ids currently rendering as a draft month. */
  byId:        Set<string>;
  /** The month each one PLANS ('YYYY-MM') → its cycle id. */
  byPlanMonth: Map<string, string>;
}

export async function loadDraftCycles(clientId: string): Promise<DraftCycles> {
  const rows = await db
    .select({
      cycleId:    contentCycles.id,
      cycleMonth: contentCycles.cycleMonth,
      drafts:     sql<number>`count(${contentCyclePosts.id}) filter (where ${contentCyclePosts.status} = ${POST_STATUS_DRAFT})::int`,
      committed:  sql<number>`count(${contentCyclePosts.id}) filter (where ${contentCyclePosts.status} <> ${POST_STATUS_DRAFT})::int`,
    })
    .from(contentCycles)
    .leftJoin(contentCyclePosts, and(
      eq(contentCyclePosts.cycleId, contentCycles.id),
      eq(contentCyclePosts.clientId, clientId),      // ownership — never trust the id alone
      isNull(contentCyclePosts.deletedAt),
    ))
    .where(eq(contentCycles.clientId, clientId))
    .groupBy(contentCycles.id, contentCycles.cycleMonth);

  const byId = new Set<string>();
  const byPlanMonth = new Map<string, string>();
  for (const r of rows) {
    if (r.drafts > 0 && r.committed === 0) {
      byId.add(r.cycleId);
      byPlanMonth.set(nextMonth(r.cycleMonth), r.cycleId);
    }
  }
  return { byId, byPlanMonth };
}

/** Is this cycle currently rendering as a draft month? */
export async function cycleIsInDraft(clientId: string, cycleId: string): Promise<boolean> {
  return (await loadDraftCycles(clientId)).byId.has(cycleId);
}

/** The plan month ('YYYY-MM') of the draft cycle this DATE would land in, or null if the
 *  date's month is not a draft month. The key a date move is refused on. */
export async function draftMonthFor(clientId: string, dateIso: string): Promise<string | null> {
  const month = dateIso.slice(0, 7);
  return (await loadDraftCycles(clientId)).byPlanMonth.has(month) ? month : null;
}

/**
 * WOULD THIS WRITE LAND IN A DRAFT MONTH? — the write-time half of the draft fence.
 *
 * Until now the fence was entirely at READ time: `loadPlanPosts` refused to SHOW drafts, and
 * nothing refused to write near them. So the ordinary path could not see a draft month but
 * could still put a row in it. Two ways, both live:
 *
 *   INSERT — `addGeneratingPost(clientId, <a draft cycle>, …)` writes `status:'generating'`
 *   into that cycle. It is not `status:'draft'`, so `loadDraftBeats` never returns it and it
 *   is invisible on the draft surface; but `loadPlanPosts` does, so `committedPostCount` goes
 *   0 → 1 and `resolveSurfaceKind` flips the month from 'draft' to committed. September's
 *   thirty planned posts, its approval flow and its receipts stop rendering. One approved
 *   agent add_post away.
 *
 *   DATE MOVE — a post keeps its own `cycle_id` through a move (nothing re-parents rows), so
 *   moving an August post to a September date flips nothing. It disappears instead: it leaves
 *   August's date-keyed grid, and `DraftSurface` renders planned posts only — no
 *   `crossMonthPosts` — so it never arrives in September either.
 *
 * `cycleId` is checked for inserts (the row lands there); `date` for both (the month it will
 * show in). Passing neither returns false and leaves behaviour unchanged.
 *
 * Lives here rather than in `mutations.ts` because both the mutation layer AND the routes need
 * it: the mutation layer to make the refusal unbypassable, the routes to say WHY (a bare null
 * from `mutations.ts` is indistinguishable from the past-date refusal beside it, and would
 * render as "that date has already passed").
 */
export async function landsInDraftMonth(clientId: string, cycleId: string | null, date: string | null): Promise<boolean> {
  if (!cycleId && !date) return false;
  const draft = await loadDraftCycles(clientId);
  if (cycleId && draft.byId.has(cycleId)) return true;
  if (date && draft.byPlanMonth.has(date.slice(0, 7))) return true;
  return false;
}
