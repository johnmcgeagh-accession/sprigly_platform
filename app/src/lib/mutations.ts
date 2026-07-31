/**
 * mutations.ts — Phase 2 structural edits. Every op is a plain, synchronous DB
 * write returning the `applied` branch of ShapeResult (no LLM, no queue). All are
 * scoped server-side to the session's client+cycle: a post is only touched if it
 * belongs to (clientId, cycleId). `updated_at` is bumped by the 0050 trigger.
 *
 * The `pending` (regen) branch is Phase 3 — not here.
 */
import { and, eq, isNull, desc } from 'drizzle-orm';
import { db, contentCyclePosts, DRAFT_PLACEHOLDER_CAPTION } from '@sprigly/db';
import { QUOTA_BANKED_KEY, QUOTA_BANKED_AT_KEY } from '@sprigly/engine/ai-change-cap';
import type { ContentCyclePostRow } from '@sprigly/db';
import { loadPlanPosts } from '@/lib/plan';
import { resolveRevert } from '@/lib/revert';
import { recordActivity, USER_ACTOR, type ActivityActor, type ActivityAction } from '@/lib/activity';
import { isEditableDate, canAddPost, editScopeToday } from '@/lib/edit-scope';
import { normalisePostingTime } from '@/lib/posting-time';
import type { ShapeResult, PostFormat } from '@/lib/types';

const FORMATS = new Set<PostFormat>(['reel', 'carousel', 'single', 'email']);


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
  /**
   * Gap 1, the WRITE half — 'HH:MM'.
   *
   * There is no posting_time column, and adding one would be a schema change for a value the
   * planning path has always written to `source_meta.postingTime`. This writes the same key
   * the same way, so the surface reads back exactly what the planner wrote and one field has
   * one home. An empty string clears it.
   */
  postingTime?: string;
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
  // Posting time rides on source_meta, MERGED rather than replaced: the same blob carries
  // title, pendingInstruction, generationError and the sweep count, and none of them is this
  // write's business. A malformed value is refused rather than stored — the reader would drop
  // it anyway, and storing it would leave the row disagreeing with every surface.
  if (typeof patch.postingTime === 'string') {
    const t = patch.postingTime.trim() === '' ? null : normalisePostingTime(patch.postingTime);
    if (t !== null || patch.postingTime.trim() === '') {
      set.sourceMeta = { ...((row.sourceMeta ?? {}) as Record<string, unknown>), postingTime: t };
    }
  }

  // Ledger action reflects the primary field changed, so the history reads legibly.
  const action: ActivityAction =
    patch.date !== undefined     ? 'rescheduled'
    : patch.caption !== undefined ? 'caption_saved'
    : patch.hook !== undefined    ? 'hook_saved'
    : patch.script !== undefined  ? 'script_saved'
    : patch.format !== undefined  ? 'format_changed'
    : patch.position !== undefined ? 'reordered'
    // A time change is a reschedule with the date left alone — the ledger should read that way.
    : patch.postingTime !== undefined ? 'rescheduled'
    : 'post_updated';
  const payload: Record<string, unknown> = {};
  if (patch.date !== undefined)   { payload['from'] = row.scheduledDate; payload['to'] = patch.date; }
  if (patch.format !== undefined) { payload['fromFormat'] = row.format; payload['toFormat'] = patch.format; }
  if (patch.postingTime !== undefined) { payload['fromTime'] = (row.sourceMeta as Record<string, unknown> | null)?.['postingTime'] ?? null; payload['toTime'] = patch.postingTime; }

  await db.transaction(async (tx) => {
    await tx.update(contentCyclePosts).set(set).where(scopedPost(clientId, cycleId, postId));
    await recordActivity(tx, { clientId, cycleId, postId, action, actor, payload });
  });

  const what = patch.date ? 'Moved it.' : patch.postingTime !== undefined ? 'Time changed.' : patch.format ? 'Changed the format.' : patch.caption !== undefined ? 'Saved your caption.' : patch.hook !== undefined ? 'Hook saved.' : patch.script !== undefined ? 'Script saved.' : patch.position !== undefined ? 'Reordered.' : 'Updated.';
  return applied(clientId, cycleId, [postId], what);
}

/** Add a draft post (status 'new', placeholder caption) at a given date. `format` is the
 *  post's format (reel/carousel/single; default single — email is not creatable). Records
 *  a post_created ledger row atomically. */
export async function addDraft(clientId: string, cycleId: string, channel: string, date: string, actor: ActivityActor = USER_ACTOR, format = 'single', today: string = editScopeToday(), title?: string | null): Promise<ShapeResult | null> {
  if (!canAddPost(date, today)) return null;   // ADD POLICY: see canAddPost
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
        caption:       DRAFT_PLACEHOLDER_CAPTION,
        status:        'new',
        position,
        // No original → revert removes it. A stated subject rides in as the slot title (X3).
        sourceMeta:    title?.trim() ? { title: title.trim() } : {},
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
  if (!canAddPost(spec.date, today)) return null;   // ADD POLICY: see canAddPost
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
  /**
   * `title` (X3) is the SLOT TITLE — what every surface reads for the card's heading
   * (`card-text.ts`). Optional, and absent means absent: a post added with no stated subject
   * genuinely has no title yet, and "Untitled" is the honest rendering of that. What was wrong
   * before is that a post added WITH a subject had none either.
   */
  spec: { channel: string; date: string; instruction: string; format?: string | null; title?: string | null },
  actor: ActivityActor = USER_ACTOR, today: string = editScopeToday(),
): Promise<{ postId: string } | null> {
  if (!canAddPost(spec.date, today)) return null;   // ADD POLICY: see canAddPost
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
        sourceMeta: { pendingInstruction: spec.instruction, ...(spec.title?.trim() ? { title: spec.title.trim() } : {}) },
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

/**
 * BANK a post's generation against the monthly cap (X2b).
 *
 * Deliberately NOT `markPostGenerationFailed` with a different sentence. Three things need to
 * tell a banked post from a broken one, and none of them can do it from prose: the surface
 * renders a different state, the sweep must never retry it, and the banked-run trigger has to
 * find it. So the FLAG is the fact and the message is only copy.
 *
 * The instruction is stored the way a retry stores it — `pendingInstruction` — because that is
 * exactly what this is: the same work, deferred. Nothing new is invented to hold it, and the
 * release path (`banked-changes.ts`) re-runs it through `instructionFor`, the same reader the
 * sweep uses.
 */
export async function markPostBanked(
  clientId: string, cycleId: string, postId: string, instruction: string, message: string,
  now: Date = new Date(),
): Promise<void> {
  const row = await ownedPost(clientId, cycleId, postId);
  if (!row) return;
  const meta = {
    ...((row.sourceMeta ?? {}) as Record<string, unknown>),
    pendingInstruction: instruction,
    generationError: message,
    [QUOTA_BANKED_KEY]: true,
    [QUOTA_BANKED_AT_KEY]: now.toISOString(),
  };
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
