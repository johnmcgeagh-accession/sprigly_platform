/**
 * mutations.ts — Phase 2 structural edits. Every op is a plain, synchronous DB
 * write returning the `applied` branch of ShapeResult (no LLM, no queue). All are
 * scoped server-side to the session's client+cycle: a post is only touched if it
 * belongs to (clientId, cycleId). `updated_at` is bumped by the 0050 trigger.
 *
 * The `pending` (regen) branch is Phase 3 — not here.
 */
import { and, eq, isNull, desc } from 'drizzle-orm';
import { db, contentCyclePosts } from '@sprigly/db';
import type { ContentCyclePostRow } from '@sprigly/db';
import { loadPlanPosts } from '@/lib/plan';
import { resolveRevert } from '@/lib/revert';
import type { ShapeResult, PostFormat } from '@/lib/types';

const FORMATS = new Set<PostFormat>(['reel', 'carousel', 'single', 'email']);
const DRAFT_PLACEHOLDER = 'Draft idea — tell Sprigly what this post should be about and it\'ll write the caption.';

/** Fetch a post only if it belongs to this session's client+cycle (and isn't deleted). */
async function ownedPost(clientId: string, cycleId: string, postId: string): Promise<ContentCyclePostRow | null> {
  const [row] = await db
    .select()
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.id, postId),
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.cycleId, cycleId),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);
  return row ?? null;
}

async function applied(clientId: string, cycleId: string, changedPostIds: string[], summary: string): Promise<ShapeResult> {
  const posts = await loadPlanPosts(clientId, cycleId);
  return { mode: 'applied', summary, changedPostIds, posts };
}

export interface PostPatch {
  date?:     string;   // 'YYYY-MM-DD'
  format?:   string;
  pillar?:   string;
  position?: number;
  caption?:  string;   // free-text edit (structural). Instructed rewrites are Phase 3.
}

/** PATCH a post: date / format / pillar / position / caption. Flips status to
 *  'edited' (keeps 'new' for an added draft). Returns null if not owned. */
export async function patchPost(clientId: string, cycleId: string, postId: string, patch: PostPatch): Promise<ShapeResult | null> {
  const row = await ownedPost(clientId, cycleId, postId);
  if (!row) return null;

  const set: Partial<ContentCyclePostRow> = {
    status: row.status === 'new' ? 'new' : 'edited',
  };
  if (typeof patch.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) set.scheduledDate = patch.date;
  if (typeof patch.format === 'string' && FORMATS.has(patch.format as PostFormat)) set.format = patch.format;
  if (typeof patch.pillar === 'string')   set.pillar = patch.pillar;
  if (typeof patch.position === 'number' && Number.isFinite(patch.position)) set.position = Math.trunc(patch.position);
  if (typeof patch.caption === 'string')  set.caption = patch.caption;

  await db.update(contentCyclePosts).set(set).where(eq(contentCyclePosts.id, postId));

  const what = patch.date ? 'Moved it.' : patch.format ? 'Changed the format.' : patch.caption !== undefined ? 'Saved your caption.' : patch.position !== undefined ? 'Reordered.' : 'Updated.';
  return applied(clientId, cycleId, [postId], what);
}

/** Add a draft post (status 'new', placeholder caption) at a given date. */
export async function addDraft(clientId: string, cycleId: string, channel: string, date: string): Promise<ShapeResult> {
  // place it last
  const [maxRow] = await db
    .select({ position: contentCyclePosts.position })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.cycleId, cycleId), eq(contentCyclePosts.clientId, clientId)))
    .orderBy(desc(contentCyclePosts.position))
    .limit(1);
  const position = (maxRow?.position ?? 0) + 1;

  const [created] = await db
    .insert(contentCyclePosts)
    .values({
      clientId, cycleId, channel,
      scheduledDate: date,
      format:        'single',
      pillar:        'New idea',
      caption:       DRAFT_PLACEHOLDER,
      status:        'new',
      position,
      sourceMeta:    {},   // no original → revert removes it
    })
    .returning({ id: contentCyclePosts.id });

  return applied(clientId, cycleId, created ? [created.id] : [], 'Added a draft post.');
}

/** Soft-delete (recoverable; reconciliation can still see it). Owned-scope only. */
export async function softDeletePost(clientId: string, cycleId: string, postId: string): Promise<ShapeResult | null> {
  const row = await ownedPost(clientId, cycleId, postId);
  if (!row) return null;
  await db.update(contentCyclePosts).set({ deletedAt: new Date() }).where(eq(contentCyclePosts.id, postId));
  return applied(clientId, cycleId, [postId], 'Removed it.');
}

/** Revert: a drafted ('new') post is removed; otherwise restore the original
 *  values captured in source_meta.original and clear the 'edited' status. */
export async function revertPost(clientId: string, cycleId: string, postId: string): Promise<ShapeResult | null> {
  const row = await ownedPost(clientId, cycleId, postId);
  if (!row) return null;

  // Decision is pure (source_meta.original is the baseline — never touched by an
  // edit or regen, so revert always returns to the generated starting point).
  const decision = resolveRevert(row);
  if (decision.action === 'remove') {
    await db.update(contentCyclePosts).set({ deletedAt: new Date() }).where(eq(contentCyclePosts.id, postId));
    return applied(clientId, cycleId, [postId], 'Removed the draft.');
  }
  if (decision.action === 'clear') {
    await db.update(contentCyclePosts).set({ status: 'planned' }).where(eq(contentCyclePosts.id, postId));
    return applied(clientId, cycleId, [postId], 'Reverted.');
  }
  await db.update(contentCyclePosts).set(decision.values).where(eq(contentCyclePosts.id, postId));
  return applied(clientId, cycleId, [postId], 'Reverted to the original.');
}
