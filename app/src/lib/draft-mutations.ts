/**
 * draft-mutations.ts — deterministic structural edits on DRAFT beats. (Build B)
 *
 * A draft is uncommitted working state: the client is shaping a proposal, not editing a
 * plan. So these mutations are plainer than mutations.ts by design — no LLM, no queue, no
 * revert baseline, and a hard delete rather than a soft one. There is nothing yet to
 * preserve.
 *
 * Every mutation is guarded twice, on facts rather than on trust:
 *   1. the row must be status='draft' — a committed post can never be reached from here
 *   2. the cycle must be PRE-CUTOFF — after cutoff the draft is being acted on
 * plus the ownership scoping every write in this app carries (client + cycle in the
 * WHERE, not just in a preceding SELECT).
 *
 * NOTHING here touches `status`. Turning drafts into a plan is approval, and approval is
 * Build D. Keeping status out of this module means no edit can accidentally commit a plan
 * the client never approved.
 */
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  db, contentCycles, contentCyclePosts, clientPlanningConfig,
  POST_STATUS_DRAFT, PRE_PLANNING_STATUSES, type BeatMeta,
} from '@sprigly/db';
import { loadDraftBeats } from '@/lib/plan';
import { isEditableDate, editScopeToday } from '@/lib/edit-scope';
import { recordActivity, USER_ACTOR } from '@/lib/activity';
import type { DraftBeatView, PostFormat } from '@/lib/types';

/** Formats a draft beat may take. 'email' is excluded: these are social beats, and the
 *  app's add-post path already refuses it for the same reason. */
const BEAT_FORMATS = new Set<PostFormat>(['reel', 'carousel', 'single']);

export type DraftMutationError =
  | 'not_found'        // not this client's draft row (never leaks whose it is)
  | 'not_a_draft'      // the row exists but is a committed post
  | 'cutoff_passed'    // the cycle has moved past its intake window
  | 'read_only_date'   // the target date is in the past
  | 'invalid_format'
  | 'invalid_pillar';

export type DraftMutationResult =
  | { ok: true;  beats: DraftBeatView[]; dropped?: DroppedBeat }
  | { ok: false; error: DraftMutationError; message: string };

/**
 * A dropped beat — now just its id.
 *
 * ── The history this shape records ───────────────────────────────────────────────────
 *
 * Undo originally re-added with {date, format, pillar} and nothing else, which routed through
 * addBeat and manufactured a NEW beat: title = the pillar name, basis = 'client_added',
 * clientTouched = true, position at the end, and the rationale, sourceRef and assumptions
 * simply gone. Undoing a launch-arc beat therefore destroyed it rather than restoring it —
 * which is where the seven subjectless husks in cycle 040d6a1a came from
 * (docs/reports/uat-findings-fixes.md, Part 0).
 *
 * The fix was to send the WHOLE beat out to the client and take it back on undo, so nothing
 * was reconstructed from too little. That was the right fix for a hard delete: the row was
 * gone, so the client's copy was the only copy.
 *
 * ── Why it shrinks back to an id ─────────────────────────────────────────────────────
 *
 * The drop is a tombstone now, so the row IS the copy. Sending its contents to the client and
 * trusting them back is no longer the cheapest way to restore it — it is just a trust boundary
 * with nothing on the other side of it. Undo clears `deleted_at` on a row the server re-reads
 * for itself, so the restored beat is not merely equal to the dropped one, it is the same row,
 * same id, same evidence, and the husk failure above is structurally unavailable rather than
 * defended against.
 *
 * It still survives a refetch between drop and undo, for the same reason as before: the id is
 * the caller's to keep, not a lookup.
 */
export interface DroppedBeat {
  id: string;
}

const MESSAGES: Record<DraftMutationError, string> = {
  // "planned post", never "beat" (spec §7). This string is returned as `message` from
  // /api/plan/draft and flashed straight onto the client's screen by useDraftMonth.
  not_found:       'We couldn’t find that planned post.',
  not_a_draft:     'That post is already part of your plan, so it can’t be edited as a draft.',
  cutoff_passed:   'This month’s draft is closed for changes.',
  read_only_date:  'That date has already passed.',
  invalid_format:  'That isn’t a format we can plan for.',
  invalid_pillar:  'That isn’t one of your content pillars.',
};

const fail = (error: DraftMutationError): DraftMutationResult => ({ ok: false, error, message: MESSAGES[error] });

/**
 * Record a draft mutation on the plan_activity ledger.
 *
 * OBSERVABILITY ONLY — nothing reads these to make a decision, and nothing should. They
 * exist because a draft drop is a hard delete with no tombstone and these mutations wrote
 * no trace at all: when six launch-arc beats vanished from cycle 040d6a1a before approval,
 * the data could not say what removed them (docs/reports/wrong-month-generated.md §6).
 *
 * Best-effort. A ledger failure must never fail the mutation it describes — losing the
 * record of an edit is bad; losing the edit is worse. Deliberately NOT inside the
 * mutation's transaction for the same reason.
 *
 * Payload is minimal by intent: what the beat was, when it sat, and where it came from.
 * The provenance (`basis`) is the field that would have answered the uat question fastest.
 */
async function recordBeatActivity(params: {
  clientId: string; cycleId: string; postId: string | null;
  action: 'beat_added' | 'beat_dropped' | 'beat_restored' | 'beat_moved' | 'beat_format_changed';
  title: string; date: string; beatMeta: BeatMeta | null;
  extra?: Record<string, unknown>;
}): Promise<void> {
  try {
    const basis = (params.beatMeta?.rationaleEvidence as { basis?: unknown } | undefined)?.basis;
    await recordActivity(db, {
      clientId: params.clientId,
      cycleId:  params.cycleId,
      postId:   params.postId,
      action:   params.action,
      actor:    USER_ACTOR,          // every draft mutation is the client's own hand
      payload: {
        title: params.title,
        date:  params.date,
        basis: typeof basis === 'string' ? basis : null,
        ...(params.extra ?? {}),
      },
    });
  } catch { /* observability must never break the thing it observes */ }
}

const titleOf = (sourceMeta: Record<string, unknown> | null, pillar: string | null): string =>
  typeof sourceMeta?.['title'] === 'string' ? (sourceMeta['title'] as string) : (pillar ?? '');

/** The (id, client, cycle) scope every write carries — defence in depth, so a foreign id
 *  cannot mutate another client's row even if a check is missed upstream.
 *
 *  `deleted_at IS NULL` is part of the scope, not a nicety. A dropped beat is now a tombstone
 *  rather than a deleted row, so without this clause every mutation here would still reach it:
 *  a client holding a stale list could move, reformat or re-drop a beat they had already
 *  removed, and the write would succeed silently against a row no reader can see. The draft
 *  READS have always filtered it (plan.ts, draft-apply.ts); the writes had no need to until
 *  the row started surviving. */
function scopedDraft(clientId: string, cycleId: string, postId: string) {
  return and(
    eq(contentCyclePosts.id, postId),
    eq(contentCyclePosts.clientId, clientId),
    eq(contentCyclePosts.cycleId, cycleId),
    eq(contentCyclePosts.status, POST_STATUS_DRAFT),   // the guard, IN the write itself
    isNull(contentCyclePosts.deletedAt),               // a tombstone is not a beat
  );
}

/** Is this cycle still inside its intake window? Uses PRE_PLANNING_STATUSES — the same
 *  pre/post-cutoff classifier the intake route uses — so "pre-cutoff" cannot come to mean
 *  two different things in two places. */
export async function cycleIsPreCutoff(cycleId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: contentCycles.status, approvedAt: contentCycles.approvedAt })
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);
  if (!row) return false;
  // APPROVAL CLOSES THIS DOOR (Build D). Once a month is approved, generation is running
  // against those exact rows and their structure is fixed by contract. A structural edit
  // arriving mid-fan-out would change a slot the generator is already writing into.
  // Post-approval structural changes go through the existing paths (the post-cutoff agent,
  // admin) — never through the draft mutation API.
  if (row.approvedAt) return false;
  return PRE_PLANNING_STATUSES.has(row.status);
}

interface MutableDraft { cycleId: string; scheduledDate: string; channel: string; position: number; pillar: string | null; beatMeta: BeatMeta | null; sourceMeta: Record<string, unknown> | null }

/**
 * Resolve a draft row this client may mutate, or the reason they may not.
 *
 * Deliberately distinguishes not_found from not_a_draft. They are different facts and the
 * client deserves the true one: "we can't find that" when the id isn't theirs, and "that's
 * already in your plan" when it is theirs but committed. Neither reveals another client's
 * data, because both queries are client-scoped.
 */
async function requireDraftMutable(clientId: string, postId: string): Promise<MutableDraft | DraftMutationError> {
  const [row] = await db
    .select({
      cycleId:       contentCyclePosts.cycleId,
      scheduledDate: contentCyclePosts.scheduledDate,
      channel:       contentCyclePosts.channel,
      position:      contentCyclePosts.position,
      pillar:        contentCyclePosts.pillar,
      beatMeta:      contentCyclePosts.beatMeta,
      sourceMeta:    contentCyclePosts.sourceMeta,
      status:        contentCyclePosts.status,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.id, postId),
      eq(contentCyclePosts.clientId, clientId),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);

  if (!row) return 'not_found';
  if (row.status !== POST_STATUS_DRAFT) return 'not_a_draft';
  if (!(await cycleIsPreCutoff(row.cycleId))) return 'cutoff_passed';
  return { cycleId: row.cycleId, scheduledDate: row.scheduledDate, channel: row.channel, position: row.position, pillar: row.pillar, beatMeta: row.beatMeta, sourceMeta: row.sourceMeta };
}

const isError = (v: MutableDraft | DraftMutationError): v is DraftMutationError => typeof v === 'string';

/**
 * Stamp beat_meta.clientTouched on a beat the client has just edited.
 *
 * Build C's transforms read this and will never auto-replace a touched beat. The client's
 * hand outranks the algorithm: silently evicting something they just placed to make room
 * for something we inferred is the fastest way to lose their trust in the surface.
 *
 * Merged into the existing beat_meta rather than overwriting it, so the beat keeps the
 * evidence it was assembled on — "you moved this" and "carousels do well for you" are
 * both true and the client should be able to see both.
 */
function withClientTouched(beatMeta: BeatMeta | null): BeatMeta {
  const base: BeatMeta = beatMeta ?? { slotType: 'proven', rationaleEvidence: { basis: 'template' } };
  return { ...base, clientTouched: true };
}

/** The client's configured pillar names for this channel. Empty means unconfigured, which
 *  we treat as "cannot validate" — see addBeat.
 *
 *  Exported for `draft-apply.ts`, which needs the SAME list to resolve an emphasis phrase to
 *  a pillar. Two readers of "what are this client's pillars" is one too many: `addBeat`
 *  refuses a pillar outside this list precisely so free text cannot reach the column, and an
 *  emphasis that resolved against a different vocabulary could put it there anyway. */
export async function pillarVocab(clientId: string, channel: string): Promise<string[]> {
  const [row] = await db
    .select({ pillars: clientPlanningConfig.pillars })
    .from(clientPlanningConfig)
    .where(and(eq(clientPlanningConfig.clientId, clientId), eq(clientPlanningConfig.channel, channel)))
    .limit(1);
  return (row?.pillars ?? [])
    .map((p) => (p as { name?: unknown }).name)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
}

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Move a beat to a new date.
 *
 * `scheduled_date` is the only stored date field — there is no separate `day` column on
 * content_cycle_posts (the day-name lives in source_meta for GENERATED posts only, and a
 * draft beat has none). So the "date and day are one logical field" rule from the
 * structural-merge work is satisfied here by there being nothing to desynchronise. Noted
 * because the rule is real; it just lands differently on this table.
 */
export async function moveBeat(
  clientId: string, postId: string, newDate: string, today: string = editScopeToday(),
): Promise<DraftMutationResult> {
  const ctx = await requireDraftMutable(clientId, postId);
  if (isError(ctx)) return fail(ctx);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return fail('read_only_date');
  if (!isEditableDate(newDate, today)) return fail('read_only_date');

  await db.update(contentCyclePosts)
    .set({ scheduledDate: newDate, beatMeta: withClientTouched(ctx.beatMeta) })
    .where(scopedDraft(clientId, ctx.cycleId, postId));
  await recordBeatActivity({
    clientId, cycleId: ctx.cycleId, postId, action: 'beat_moved',
    title: titleOf(ctx.sourceMeta, ctx.pillar), date: newDate, beatMeta: ctx.beatMeta,
    extra: { from: ctx.scheduledDate },
  });
  return { ok: true, beats: await loadDraftBeats(clientId, ctx.cycleId) };
}

/** Change a beat's format, vocab-checked. */
export async function swapFormat(clientId: string, postId: string, format: string): Promise<DraftMutationResult> {
  const ctx = await requireDraftMutable(clientId, postId);
  if (isError(ctx)) return fail(ctx);
  if (!BEAT_FORMATS.has(format as PostFormat)) return fail('invalid_format');

  await db.update(contentCyclePosts)
    .set({ format, beatMeta: withClientTouched(ctx.beatMeta) })
    .where(scopedDraft(clientId, ctx.cycleId, postId));
  await recordBeatActivity({
    clientId, cycleId: ctx.cycleId, postId, action: 'beat_format_changed',
    title: titleOf(ctx.sourceMeta, ctx.pillar), date: ctx.scheduledDate, beatMeta: ctx.beatMeta,
    extra: { format },
  });
  return { ok: true, beats: await loadDraftBeats(clientId, ctx.cycleId) };
}

/**
 * Remove a beat. A TOMBSTONE, not a hard delete.
 *
 * This used to hard-delete, on the stated premise that "a draft beat is uncommitted working
 * state with no edit history". That premise is false: caption generation writes `post_edits`
 * for draft beats, and `post_edits.post_id` has no ON DELETE action, so the delete was refused
 * outright — every one of the 27 beats on ivy-t's September draft was undeletable, and the
 * client could not remove a beat they did not want.
 *
 * The FK is not the thing to change. `post_edits` is the billing ledger (one `passed` row is
 * one paid AI change) and the backstop that stops a whole-plan regen destroying work the client
 * chose — `planning.ts` hard-deletes during a regen and relies on it. Cascading it away would
 * refund allowance nobody granted; dropping it would remove the protection to fix an unrelated
 * path. So the delete gives way instead.
 *
 * The old objection to tombstoning — "every draft reader would have to learn to skip them" —
 * had already been paid for: `loadDraftBeats` and `loadDraftTransformBeats` both filter
 * `deleted_at IS NULL` today. What was missing was the WRITE side, which `scopedDraft` now
 * carries.
 *
 * ALWAYS a tombstone, never a purge, even for a beat nothing references — because undo is
 * "clear `deleted_at`" and a purged row has nothing to clear. Re-assembly makes the other
 * choice (see `retireDraftPosts`): it is the whole month and it is not reversible.
 */
export async function dropBeat(clientId: string, postId: string): Promise<DraftMutationResult> {
  const ctx = await requireDraftMutable(clientId, postId);
  if (isError(ctx)) return fail(ctx);

  await db
    .update(contentCyclePosts)
    .set({ deletedAt: new Date() })
    .where(scopedDraft(clientId, ctx.cycleId, postId));

  await recordBeatActivity({
    clientId, cycleId: ctx.cycleId,
    postId,                                   // the row survives now, so the ledger can name it
    action: 'beat_dropped',
    title: titleOf(ctx.sourceMeta, ctx.pillar),
    date: ctx.scheduledDate, beatMeta: ctx.beatMeta,
  });

  // The id is the whole undo. Nothing about the beat's CONTENT crosses to the client and back
  // any more, which is what makes the restore below unforgeable — see DroppedBeat.
  return { ok: true, beats: await loadDraftBeats(clientId, ctx.cycleId), dropped: { id: postId } };
}

/**
 * Put a dropped beat back — by clearing its tombstone.
 *
 * This used to re-INSERT the beat from a snapshot the client handed back, because the drop had
 * genuinely deleted the row. That is no longer true, and the difference matters: the beat does
 * not come back EQUAL to the one that was dropped, it comes back AS it, with the id every
 * receipt, ledger row and post_edits row already names. A restore that mints a new id would
 * orphan all three.
 *
 * ── What this removes, and why the guards go with it ─────────────────────────────────
 *
 * The old signature took the beat's date, format, pillar, title, position and evidence from the
 * client. It re-derived access server-side and re-applied addBeat's validators to that payload
 * — invalid_format, invalid_pillar, the date check — which was the right shape for input the
 * client supplied. None of it is supplied any more. The row's own format and pillar were
 * validated when it was created and have not been anywhere since, so re-validating them would
 * be re-checking the database against itself.
 *
 * The date check stays, and is now the beat's OWN date rather than a claimed one: a beat whose
 * day has passed while it sat dropped cannot be restored into a day the client can no longer
 * edit, which is the same rule every other draft write obeys.
 *
 * ── Scoping ──────────────────────────────────────────────────────────────────────────
 *
 * The lookup carries (id, client, cycle, draft, deleted_at IS NOT NULL) — the mirror of
 * `scopedDraft`, inverted on exactly one clause. So this can only ever un-drop a tombstone that
 * belongs to this client on this cycle: not another client's row, not a committed post, and not
 * a live beat (which would be a no-op that reported success).
 */
export async function restoreBeat(
  clientId: string, cycleId: string, beat: DroppedBeat, today: string = editScopeToday(),
): Promise<DraftMutationResult> {
  if (!(await cycleIsPreCutoff(cycleId))) return fail('cutoff_passed');

  const [row] = await db
    .select({
      scheduledDate: contentCyclePosts.scheduledDate,
      pillar:        contentCyclePosts.pillar,
      beatMeta:      contentCyclePosts.beatMeta,
      sourceMeta:    contentCyclePosts.sourceMeta,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.id, beat.id),
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
      isNotNull(contentCyclePosts.deletedAt),          // only a tombstone can be un-dropped
    ))
    .limit(1);
  if (!row) return fail('not_found');

  if (!isEditableDate(row.scheduledDate, today)) return fail('read_only_date');

  await db
    .update(contentCyclePosts)
    .set({ deletedAt: null })
    .where(and(
      eq(contentCyclePosts.id, beat.id),
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
    ));

  await recordBeatActivity({
    clientId, cycleId, postId: beat.id, action: 'beat_restored',
    title: titleOf(row.sourceMeta, row.pillar), date: row.scheduledDate, beatMeta: row.beatMeta,
  });

  return { ok: true, beats: await loadDraftBeats(clientId, cycleId) };
}

export interface AddBeatSpec {
  date: string;
  format: string;
  pillar: string;
  /**
   * What the client said this post is about (round 6, P1). Optional, and never invented.
   *
   * It becomes the beat's TITLE, which is what the card shows and what the caption instruction
   * names at generation. Without it the title falls back to the pillar, which is why every
   * client-added beat used to be called "Home & Space" — a slot named after its category rather
   * than after the thing the client had in mind when they added it.
   */
  subject?: string;
}

/**
 * Add a beat the client asked for.
 *
 * Its evidence is {basis:'client_added'} and nothing else. The client added it, so there
 * is no engagement figure, no pillar share and no cadence basis to cite — and inventing
 * one to make the beat look as "grounded" as its neighbours would be the exact dishonesty
 * the structured-evidence contract exists to prevent. An unexplained beat the client chose
 * is a perfectly good beat.
 *
 * A subject does NOT change the basis. `client_added` says the client placed this slot; the
 * subject is what they called it, not a second kind of evidence.
 */
export async function addBeat(
  clientId: string, cycleId: string, spec: AddBeatSpec, today: string = editScopeToday(),
): Promise<DraftMutationResult> {
  if (!(await cycleIsPreCutoff(cycleId))) return fail('cutoff_passed');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.date) || !isEditableDate(spec.date, today)) return fail('read_only_date');
  if (!BEAT_FORMATS.has(spec.format as PostFormat)) return fail('invalid_format');

  // Channel comes from the cycle, never the caller — a client cannot plant a beat on a
  // channel they did not ask about.
  const [cycle] = await db
    .select({ channel: contentCycles.channel })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
    .limit(1);
  if (!cycle) return fail('not_found');

  const vocab = await pillarVocab(clientId, cycle.channel);
  // An unconfigured client has no vocab to check against. Refuse rather than accept
  // anything: a free-text pillar would poison the pillar weights the assembler reads.
  if (vocab.length === 0 || !vocab.includes(spec.pillar)) return fail('invalid_pillar');

  const [maxRow] = await db
    .select({ position: sql<number>`coalesce(max(${contentCyclePosts.position}), -1)::int` })
    .from(contentCyclePosts)
    .where(and(eq(contentCyclePosts.cycleId, cycleId), eq(contentCyclePosts.clientId, clientId)));

  const beatMeta: BeatMeta = {
    slotType: 'proven',
    rationaleEvidence: { basis: 'client_added' },
    clientTouched: true,   // they placed it; no transform may quietly take the slot back
  };

  const title = spec.subject?.trim() || spec.pillar;

  const [added] = await db.insert(contentCyclePosts).values({
    clientId, cycleId, channel: cycle.channel,
    scheduledDate: spec.date,
    format:        spec.format,
    pillar:        spec.pillar,
    caption:       null,
    status:        POST_STATUS_DRAFT,
    position:      (maxRow?.position ?? -1) + 1,
    beatMeta,
    sourceMeta:    { title },
  }).returning({ id: contentCyclePosts.id });

  await recordBeatActivity({
    clientId, cycleId, postId: added?.id ?? null, action: 'beat_added',
    title, date: spec.date, beatMeta, extra: { format: spec.format },
  });

  return { ok: true, beats: await loadDraftBeats(clientId, cycleId) };
}

/**
 * Reorder beats sharing a date.
 *
 * Position IS meaningful within a day: loadDraftBeats orders by (scheduled_date, position),
 * so position is the tiebreak whenever a date holds more than one beat. The assembler never
 * produces same-date beats (spreadDates samples distinct days), but addBeat can, so the
 * concept is real rather than invented for its own sake.
 *
 * Takes the full ordered id list for that date and renumbers it. Ids not on that date, or
 * not this client's drafts, are ignored rather than erroring — a stale client list should
 * reorder what it legitimately can, not fail wholesale.
 */
export async function reorderWithinDay(
  clientId: string, cycleId: string, date: string, orderedPostIds: string[],
): Promise<DraftMutationResult> {
  if (!(await cycleIsPreCutoff(cycleId))) return fail('cutoff_passed');

  const rows = await db
    .select({ id: contentCyclePosts.id, position: contentCyclePosts.position })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
      eq(contentCyclePosts.scheduledDate, date),
      isNull(contentCyclePosts.deletedAt),
    ))
    .orderBy(asc(contentCyclePosts.position));

  const onThisDate = new Set(rows.map((r) => r.id));
  const requested  = orderedPostIds.filter((id) => onThisDate.has(id));
  // Anything the caller omitted keeps its relative order, appended after.
  const remainder  = rows.map((r) => r.id).filter((id) => !requested.includes(id));
  const finalOrder = [...requested, ...remainder];

  // Reuse the block of positions these rows already occupy, so a reorder within a day
  // cannot disturb the ordering of any other day.
  const slots = rows.map((r) => r.position).sort((a, b) => a - b);
  await db.transaction(async (tx) => {
    for (let i = 0; i < finalOrder.length; i++) {
      await tx.update(contentCyclePosts)
        .set({ position: slots[i] ?? i })
        .where(scopedDraft(clientId, cycleId, finalOrder[i]!));
    }
  });

  return { ok: true, beats: await loadDraftBeats(clientId, cycleId) };
}
