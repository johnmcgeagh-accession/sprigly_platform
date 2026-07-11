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
import { recordActivity, USER_ACTOR, type ActivityActor, type ActivityAction } from '@/lib/activity';
import { isEditableDate, editScopeToday } from '@/lib/edit-scope';
import type { ShapeResult, PostFormat } from '@/lib/types';

const FORMATS = new Set<PostFormat>(['reel', 'carousel', 'single', 'email']);
const DRAFT_PLACEHOLDER = 'Draft idea. Tell Sprigly what this post should be about and it\'ll write the caption.';

/**
 * The (id, clientId, cycleId) scope every write must carry. The preceding
 * `ownedPost` SELECT already gates access, but scoping the UPDATE itself is
 * defense-in-depth: a foreign postId can never mutate another client's or
 * cycle's row even if a check is missed upstream (audit §4).
 */
function scopedPost(clientId: string, cycleId: string, postId: string) {
  return and(
    eq(contentCyclePosts.id, postId),
    eq(contentCyclePosts.clientId, clientId),
    eq(contentCyclePosts.cycleId, cycleId),
  );
}

/** Fetch a post only if it belongs to this session's client+cycle (and isn't deleted). */
async function ownedPost(clientId: string, cycleId: string, postId: string): Promise<ContentCyclePostRow | null> {
  const [row] = await db
    .select()
    .from(contentCyclePosts)
    .where(and(scopedPost(clientId, cycleId, postId), isNull(contentCyclePosts.deletedAt)))
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
  hook?:     string;   // reel/carousel hook — free-text edit or a picked candidate (Stage 6)
  script?:   string;   // reel script — free-text edit of the generated script (Stage 6)
  scriptLengthSeconds?: number;  // 15|30|60|90
}

/** PATCH a post: date / format / pillar / position / caption. Flips status to
 *  'edited' (keeps 'new' for an added draft). Returns null if not owned. Records a
 *  plan_activity row (origin from `actor`, default user) atomically with the write. */
export async function patchPost(clientId: string, cycleId: string, postId: string, patch: PostPatch, actor: ActivityActor = USER_ACTOR, today: string = editScopeToday()): Promise<ShapeResult | null> {
  const row = await ownedPost(clientId, cycleId, postId);
  if (!row) return null;

  // DATE POLICY: a past-dated post is read-only. A date move must satisfy the rule on
  // BOTH ends — you can neither edit a post already in the past, nor move a future post
  // INTO the past. Refuse (null) rather than partially apply.
  if (!isEditableDate(row.scheduledDate, today)) return null;
  if (typeof patch.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.date) && !isEditableDate(patch.date, today)) return null;

  const set: Partial<ContentCyclePostRow> = {
    status: row.status === 'new' ? 'new' : 'edited',
  };
  if (typeof patch.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patch.date)) set.scheduledDate = patch.date;
  if (typeof patch.format === 'string' && FORMATS.has(patch.format as PostFormat)) set.format = patch.format;
  if (typeof patch.pillar === 'string')   set.pillar = patch.pillar;
  if (typeof patch.position === 'number' && Number.isFinite(patch.position)) set.position = Math.trunc(patch.position);
  if (typeof patch.caption === 'string')  set.caption = patch.caption;
  if (typeof patch.hook === 'string')     set.hook = patch.hook;
  if (typeof patch.script === 'string')   set.script = patch.script;
  if (typeof patch.scriptLengthSeconds === 'number' && [15, 30, 60, 90].includes(patch.scriptLengthSeconds)) set.scriptLengthSeconds = patch.scriptLengthSeconds;

  // Ledger action reflects the primary field changed, so the history reads legibly.
  const action: ActivityAction =
    patch.date !== undefined     ? 'rescheduled'
    : patch.caption !== undefined ? 'caption_saved'
    : patch.hook !== undefined    ? 'hook_saved'
    : patch.script !== undefined  ? 'script_saved'
    : patch.format !== undefined  ? 'format_changed'
    : patch.position !== undefined ? 'reordered'
    : 'post_updated';
  const payload: Record<string, unknown> = {};
  if (patch.date !== undefined)   { payload['from'] = row.scheduledDate; payload['to'] = patch.date; }
  if (patch.format !== undefined) { payload['fromFormat'] = row.format; payload['toFormat'] = patch.format; }

  await db.transaction(async (tx) => {
    await tx.update(contentCyclePosts).set(set).where(scopedPost(clientId, cycleId, postId));
    await recordActivity(tx, { clientId, cycleId, postId, action, actor, payload });
  });

  const what = patch.date ? 'Moved it.' : patch.format ? 'Changed the format.' : patch.caption !== undefined ? 'Saved your caption.' : patch.hook !== undefined ? 'Hook saved.' : patch.script !== undefined ? 'Script saved.' : patch.position !== undefined ? 'Reordered.' : 'Updated.';
  return applied(clientId, cycleId, [postId], what);
}

/** Add a draft post (status 'new', placeholder caption) at a given date. `format` is the
 *  post's format (reel/carousel/single; default single — email is not creatable). Records
 *  a post_created ledger row atomically. */
export async function addDraft(clientId: string, cycleId: string, channel: string, date: string, actor: ActivityActor = USER_ACTOR, format = 'single', today: string = editScopeToday()): Promise<ShapeResult | null> {
  if (!isEditableDate(date, today)) return null;   // DATE POLICY: create only for today-onward
  const fmt: PostFormat = FORMATS.has(format as PostFormat) && format !== 'email' ? (format as PostFormat) : 'single';
  // place it last
  const [maxRow] = await db
    .select({ position: contentCyclePosts.position })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.cycleId, cycleId), eq(contentCyclePosts.clientId, clientId)))
    .orderBy(desc(contentCyclePosts.position))
    .limit(1);
  const position = (maxRow?.position ?? 0) + 1;

  let newId: string | null = null;
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(contentCyclePosts)
      .values({
        clientId, cycleId, channel,
        scheduledDate: date,
        format:        fmt,
        pillar:        'New idea',
        caption:       DRAFT_PLACEHOLDER,
        status:        'new',
        position,
        sourceMeta:    {},   // no original → revert removes it
      })
      .returning({ id: contentCyclePosts.id });
    newId = created?.id ?? null;
    if (newId) await recordActivity(tx, { clientId, cycleId, postId: newId, action: 'post_created', actor, payload: { date, format: fmt } });
  });

  return applied(clientId, cycleId, newId ? [newId] : [], 'Added a draft post.');
}

/** Insert a post with pre-generated content (weekly session's weather draft).
 *  Unlike addDraft (blank placeholder), this carries a real caption/format/pillar. */
export async function addGeneratedPost(
  clientId: string, cycleId: string,
  spec: { channel: string; date: string; format: string; pillar: string; caption: string },
  actor: ActivityActor = USER_ACTOR, today: string = editScopeToday(),
): Promise<ShapeResult | null> {
  if (!isEditableDate(spec.date, today)) return null;   // DATE POLICY: create only for today-onward
  const [maxRow] = await db
    .select({ position: contentCyclePosts.position })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.cycleId, cycleId), eq(contentCyclePosts.clientId, clientId)))
    .orderBy(desc(contentCyclePosts.position))
    .limit(1);
  const position = (maxRow?.position ?? 0) + 1;

  const format = FORMATS.has(spec.format as PostFormat) ? spec.format : 'single';
  let newId: string | null = null;
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(contentCyclePosts)
      .values({
        clientId, cycleId, channel: spec.channel,
        scheduledDate: spec.date, format, pillar: spec.pillar, caption: spec.caption,
        status: 'new', position, sourceMeta: {},
      })
      .returning({ id: contentCyclePosts.id });
    newId = created?.id ?? null;
    if (newId) await recordActivity(tx, { clientId, cycleId, postId: newId, action: 'post_created', actor, payload: { date: spec.date, format } });
  });
  return applied(clientId, cycleId, newId ? [newId] : [], 'Added the post.');
}

/** Insert a post that is being generated async from an instruction. It occupies
 *  its slot immediately (status 'generating', empty caption — the UI shows a
 *  working state, never the default placeholder). The instruction is kept on
 *  source_meta so a failed generation can be retried. Returns the new post id. */
export async function addGeneratingPost(
  clientId: string, cycleId: string,
  spec: { channel: string; date: string; instruction: string; format?: string | null },
  actor: ActivityActor = USER_ACTOR, today: string = editScopeToday(),
): Promise<{ postId: string } | null> {
  if (!isEditableDate(spec.date, today)) return null;   // DATE POLICY: create only for today-onward
  const fmt: PostFormat = spec.format && FORMATS.has(spec.format as PostFormat) && spec.format !== 'email' ? (spec.format as PostFormat) : 'single';
  const [maxRow] = await db
    .select({ position: contentCyclePosts.position })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.cycleId, cycleId), eq(contentCyclePosts.clientId, clientId)))
    .orderBy(desc(contentCyclePosts.position))
    .limit(1);
  const position = (maxRow?.position ?? 0) + 1;

  let newId = '';
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(contentCyclePosts)
      .values({
        clientId, cycleId, channel: spec.channel,
        scheduledDate: spec.date, format: fmt, pillar: 'New idea', caption: '',
        status: 'generating', position,
        sourceMeta: { pendingInstruction: spec.instruction },
      })
      .returning({ id: contentCyclePosts.id });
    newId = created!.id;
    await recordActivity(tx, { clientId, cycleId, postId: newId, action: 'post_created', actor, payload: { date: spec.date, format: fmt, generating: true } });
  });
  return { postId: newId };
}

/** Mark a post as generating (retry): status 'generating', clears any prior error,
 *  keeps/refreshes the instruction. Owned-scope only; null if not found. */
export async function markPostGenerating(clientId: string, cycleId: string, postId: string, instruction: string, today: string = editScopeToday()): Promise<{ postId: string } | null> {
  const row = await ownedPost(clientId, cycleId, postId);
  if (!row) return null;
  if (!isEditableDate(row.scheduledDate, today)) return null;   // past-dated → read-only
  const meta = { ...((row.sourceMeta ?? {}) as Record<string, unknown>), pendingInstruction: instruction, generationError: null };
  await db.update(contentCyclePosts).set({ status: 'generating', sourceMeta: meta }).where(scopedPost(clientId, cycleId, postId));
  return { postId };
}

/** Mark a post's generation as failed, preserving the instruction + the reason. */
export async function markPostGenerationFailed(clientId: string, cycleId: string, postId: string, error: string): Promise<void> {
  const row = await ownedPost(clientId, cycleId, postId);
  if (!row) return;
  const meta = { ...((row.sourceMeta ?? {}) as Record<string, unknown>), generationError: error };
  await db.update(contentCyclePosts).set({ status: 'generation_failed', sourceMeta: meta }).where(scopedPost(clientId, cycleId, postId));
}

/** Soft-delete (recoverable; reconciliation can still see it). Owned-scope only.
 *  Records a post_deleted ledger row atomically. */
export async function softDeletePost(clientId: string, cycleId: string, postId: string, actor: ActivityActor = USER_ACTOR, today: string = editScopeToday()): Promise<ShapeResult | null> {
  const row = await ownedPost(clientId, cycleId, postId);
  if (!row) return null;
  if (!isEditableDate(row.scheduledDate, today)) return null;   // past-dated → read-only
  await db.transaction(async (tx) => {
    await tx.update(contentCyclePosts).set({ deletedAt: new Date() }).where(scopedPost(clientId, cycleId, postId));
    await recordActivity(tx, { clientId, cycleId, postId, action: 'post_deleted', actor });
  });
  return applied(clientId, cycleId, [postId], 'Removed it.');
}

/** Revert: a drafted ('new') post is removed; otherwise restore the original
 *  values captured in source_meta.original and clear the 'edited' status. */
export async function revertPost(clientId: string, cycleId: string, postId: string, actor: ActivityActor = USER_ACTOR, today: string = editScopeToday()): Promise<ShapeResult | null> {
  const row = await ownedPost(clientId, cycleId, postId);
  if (!row) return null;
  if (!isEditableDate(row.scheduledDate, today)) return null;   // past-dated → read-only

  // Decision is pure (source_meta.original is the baseline — never touched by an
  // edit or regen, so revert always returns to the generated starting point).
  const decision = resolveRevert(row);
  const set =
    decision.action === 'remove' ? { deletedAt: new Date() }
    : decision.action === 'clear' ? { status: 'planned' as const }
    : decision.values;
  const summary =
    decision.action === 'remove' ? 'Removed the draft.'
    : decision.action === 'clear' ? 'Reverted.'
    : 'Reverted to the original.';

  await db.transaction(async (tx) => {
    await tx.update(contentCyclePosts).set(set).where(scopedPost(clientId, cycleId, postId));
    await recordActivity(tx, { clientId, cycleId, postId, action: 'post_reverted', actor, payload: { result: decision.action } });
  });
  return applied(clientId, cycleId, [postId], summary);
}
