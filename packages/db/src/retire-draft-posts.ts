/**
 * retire-draft-posts.ts — remove draft beats without destroying what they carry.
 *
 * ── Why this is in @sprigly/db ───────────────────────────────────────────────────────
 *
 * Two processes retire draft beats and they are in different packages: the APP does it when a
 * transform's `remove` op fires (`app/src/lib/draft-apply.ts`), and the WORKER does it every
 * time it re-assembles a month (`engine/src/content-cycles/draft-plan.ts`). The rule below
 * decides whether a client's paid work survives, so two hand-written copies of it is exactly
 * the kind of duplication that drifts and then disagrees — the same reasoning that put
 * `ai-change-usage.ts` and `plan-ready-claim.ts` here.
 *
 * ── The constraint this exists to respect ────────────────────────────────────────────
 *
 * `post_edits.post_id` references `content_cycle_posts(id)` with NO ON DELETE action, so a hard
 * delete of a referenced post is refused outright:
 *
 *     update or delete on table "content_cycle_posts" violates foreign key constraint
 *     "post_edits_post_id_fkey" on table "post_edits"
 *
 * That constraint is LOAD-BEARING and must not be dropped. `post_edits` is the billing ledger —
 * one `passed = true` row is one paid AI change (`ai-change-usage.ts`) — and it is the backstop
 * `planning.ts` leans on when it hard-deletes during a regen ("FK-safe: deleteIds are
 * drop+replace only — never a post_edits-referenced row"), which is what stops a whole-plan
 * regen silently destroying work the client chose and we were paid for. Cascading it away would
 * refund allowance nobody granted and delete the only surviving copy of generated captions.
 *
 * `dropBeat`'s premise — "a draft beat is uncommitted working state with no edit history" — is
 * false in practice: caption generation writes `post_edits` for draft beats, and on ivy-t's
 * September draft all 27 beats carried one.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────
 *
 * PURGE a draft beat nothing references — it protects nothing, the FK permits it, and
 * tombstoning every beat on every re-assembly would accumulate rows for no reader's benefit.
 *
 * TOMBSTONE a draft beat that `post_edits` references — the row goes out of every draft read
 * (they already filter `deleted_at IS NULL`) while the ledger keeps its subject.
 *
 * NOT the rule `dropBeat` uses. A client drop always tombstones, whether or not the beat is
 * referenced, because its undo is "clear `deleted_at`" and a purged row has nothing to clear.
 * That is a deliberate difference: a drop is one row and reversible, a re-assembly is the whole
 * month and is not.
 */
import { and, eq, exists, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { db as _db, contentCyclePosts, postEdits, POST_STATUS_DRAFT } from './index.js';

/** The db handle or an open transaction — callers inside a transaction must pass theirs, so
 *  the purge and the tombstone commit or roll back together with the rest of their work. */
type Executor = typeof _db | Parameters<Parameters<(typeof _db)['transaction']>[0]>[0];

export interface RetireResult {
  /** Rows deleted outright — nothing referenced them. */
  purged: number;
  /** Rows marked `deleted_at` — a post_edits row still names them. */
  tombstoned: number;
}

/**
 * Retire the draft beats on a cycle: purge the unreferenced, tombstone the rest.
 *
 * Scoped to `status = 'draft'` in the statements themselves, never by the caller's filtering,
 * so a committed post can never be retired by this path whatever is passed in. Pass `postIds`
 * to retire specific beats; omit it to retire every draft beat on the cycle (re-assembly).
 */
export async function retireDraftPosts(
  exec: Executor,
  scope: { cycleId: string; clientId?: string; postIds?: string[] },
): Promise<RetireResult> {
  const { cycleId, clientId, postIds } = scope;
  if (postIds && postIds.length === 0) return { purged: 0, tombstoned: 0 };

  const base = and(
    eq(contentCyclePosts.cycleId, cycleId),
    eq(contentCyclePosts.status, POST_STATUS_DRAFT),
    ...(clientId ? [eq(contentCyclePosts.clientId, clientId)] : []),
    ...(postIds ? [inArray(contentCyclePosts.id, postIds)] : []),
  );

  /** Correlated: does any post_edits row name THIS post? */
  const referenced = exec
    .select({ one: sql`1` })
    .from(postEdits)
    .where(eq(postEdits.postId, contentCyclePosts.id));

  // Tombstone first. Doing it the other way round is also correct — the two sets are disjoint
  // — but this order means a failure between the statements leaves protected rows already
  // safe rather than still exposed.
  const tombstoned = await exec
    .update(contentCyclePosts)
    .set({ deletedAt: new Date() })
    .where(and(base, isNull(contentCyclePosts.deletedAt), exists(referenced)))
    .returning({ id: contentCyclePosts.id });

  const purged = await exec
    .delete(contentCyclePosts)
    .where(and(base, notExists(referenced)))
    .returning({ id: contentCyclePosts.id });

  return { purged: purged.length, tombstoned: tombstoned.length };
}
