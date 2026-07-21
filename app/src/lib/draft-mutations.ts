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
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  db, contentCycles, contentCyclePosts, clientPlanningConfig,
  POST_STATUS_DRAFT, PRE_PLANNING_STATUSES, type BeatMeta,
} from '@sprigly/db';
import { loadDraftBeats } from '@/lib/plan';
import { isEditableDate, editScopeToday } from '@/lib/edit-scope';
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
 * A dropped beat, complete enough to put back exactly as it was.
 *
 * Undo used to re-add with {date, format, pillar} and nothing else, which routed through
 * addBeat and manufactured a NEW beat: title = the pillar name, basis = 'client_added',
 * clientTouched = true, position at the end, and the rationale, sourceRef and assumptions
 * simply gone. Undoing a launch-arc beat therefore destroyed it rather than restoring it —
 * which is where the seven subjectless husks in cycle 040d6a1a came from
 * (docs/reports/uat-findings-fixes.md, Part 0).
 *
 * Returned by dropBeat so the caller can hold it and hand it straight back. It survives a
 * refetch between drop and undo because it is the caller's to keep, not a lookup.
 */
export interface DroppedBeat {
  date:     string;
  format:   string;
  pillar:   string;
  title:    string;
  position: number;
  beatMeta: BeatMeta | null;
}

const MESSAGES: Record<DraftMutationError, string> = {
  not_found:       'We couldn’t find that beat.',
  not_a_draft:     'That post is already part of your plan, so it can’t be edited as a draft.',
  cutoff_passed:   'This month’s draft is closed for changes.',
  read_only_date:  'That date has already passed.',
  invalid_format:  'That isn’t a format we can plan for.',
  invalid_pillar:  'That isn’t one of your content pillars.',
};

const fail = (error: DraftMutationError): DraftMutationResult => ({ ok: false, error, message: MESSAGES[error] });

/** The (id, client, cycle) scope every write carries — defence in depth, so a foreign id
 *  cannot mutate another client's row even if a check is missed upstream. */
function scopedDraft(clientId: string, cycleId: string, postId: string) {
  return and(
    eq(contentCyclePosts.id, postId),
    eq(contentCyclePosts.clientId, clientId),
    eq(contentCyclePosts.cycleId, cycleId),
    eq(contentCyclePosts.status, POST_STATUS_DRAFT),   // the guard, IN the write itself
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

interface MutableDraft { cycleId: string; scheduledDate: string; channel: string; position: number; pillar: string | null; beatMeta: BeatMeta | null }

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
  return { cycleId: row.cycleId, scheduledDate: row.scheduledDate, channel: row.channel, position: row.position, pillar: row.pillar, beatMeta: row.beatMeta };
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
 *  we treat as "cannot validate" — see addBeat. */
async function pillarVocab(clientId: string, channel: string): Promise<string[]> {
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
  return { ok: true, beats: await loadDraftBeats(clientId, ctx.cycleId) };
}

/**
 * Remove a beat. HARD delete, deliberately.
 *
 * Soft-delete exists on this table so a committed post can be restored and so post_edits
 * FKs survive. A draft beat has neither concern: it is uncommitted working state with no
 * edit history, and undo is handled by re-adding (see addBeat) rather than by resurrection.
 * Leaving tombstoned drafts around would mean every draft reader had to learn to skip them.
 */
export async function dropBeat(clientId: string, postId: string): Promise<DraftMutationResult> {
  const ctx = await requireDraftMutable(clientId, postId);
  if (isError(ctx)) return fail(ctx);

  // Snapshot BEFORE the delete: this is a hard delete, so afterwards there is nothing left
  // to reconstruct from. Handing it back is what makes undo a restore rather than a re-add.
  const [row] = await db
    .select({
      scheduledDate: contentCyclePosts.scheduledDate, format: contentCyclePosts.format,
      pillar: contentCyclePosts.pillar, position: contentCyclePosts.position,
      beatMeta: contentCyclePosts.beatMeta, sourceMeta: contentCyclePosts.sourceMeta,
    })
    .from(contentCyclePosts)
    .where(scopedDraft(clientId, ctx.cycleId, postId))
    .limit(1);

  await db.delete(contentCyclePosts).where(scopedDraft(clientId, ctx.cycleId, postId));

  const beats = await loadDraftBeats(clientId, ctx.cycleId);
  if (!row) return { ok: true, beats };
  const title = typeof row.sourceMeta?.['title'] === 'string' ? (row.sourceMeta['title'] as string) : (row.pillar ?? '');
  return {
    ok: true, beats,
    dropped: {
      date: row.scheduledDate, format: row.format, pillar: row.pillar ?? '',
      title, position: row.position, beatMeta: row.beatMeta,
    },
  };
}

/**
 * Put a dropped beat back, exactly as it was.
 *
 * Deliberately NOT addBeat with extra fields: addBeat's job is to create a beat the client
 * chose, and it stamps that provenance on purpose. Restoring is the opposite act — the row
 * should come back indistinguishable from the one that was removed, including the evidence
 * that justified it and the position it held.
 *
 * The snapshot comes from the client, so everything that decides ACCESS is re-derived
 * server-side (client, cycle, channel, draft status) and the same guards addBeat applies are
 * applied here. What the snapshot is trusted for is its own content — title, evidence,
 * position — which the server handed to that client moments earlier. The trust boundary is
 * therefore no wider than the existing 'add' op, which already lets a client name a date,
 * format and pillar.
 */
export async function restoreBeat(
  clientId: string, cycleId: string, beat: DroppedBeat, today: string = editScopeToday(),
): Promise<DraftMutationResult> {
  if (!(await cycleIsPreCutoff(cycleId))) return fail('cutoff_passed');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(beat.date) || !isEditableDate(beat.date, today)) return fail('read_only_date');
  if (!BEAT_FORMATS.has(beat.format as PostFormat)) return fail('invalid_format');

  const [cycle] = await db
    .select({ channel: contentCycles.channel })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
    .limit(1);
  if (!cycle) return fail('not_found');

  const vocab = await pillarVocab(clientId, cycle.channel);
  if (vocab.length === 0 || !vocab.includes(beat.pillar)) return fail('invalid_pillar');

  await db.insert(contentCyclePosts).values({
    clientId, cycleId, channel: cycle.channel,
    scheduledDate: beat.date,
    format:        beat.format,
    pillar:        beat.pillar,
    caption:       null,
    status:        POST_STATUS_DRAFT,
    position:      beat.position,          // its own slot back, not the end of the list
    beatMeta:      beat.beatMeta,          // the evidence that justified it, intact
    sourceMeta:    { title: beat.title },  // its subject, not its pillar's name
  });

  return { ok: true, beats: await loadDraftBeats(clientId, cycleId) };
}

export interface AddBeatSpec { date: string; format: string; pillar: string }

/**
 * Add a beat the client asked for.
 *
 * Its evidence is {basis:'client_added'} and nothing else. The client added it, so there
 * is no engagement figure, no pillar share and no cadence basis to cite — and inventing
 * one to make the beat look as "grounded" as its neighbours would be the exact dishonesty
 * the structured-evidence contract exists to prevent. An unexplained beat the client chose
 * is a perfectly good beat.
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

  await db.insert(contentCyclePosts).values({
    clientId, cycleId, channel: cycle.channel,
    scheduledDate: spec.date,
    format:        spec.format,
    pillar:        spec.pillar,
    caption:       null,
    status:        POST_STATUS_DRAFT,
    position:      (maxRow?.position ?? -1) + 1,
    beatMeta,
    sourceMeta:    { title: spec.pillar },
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
