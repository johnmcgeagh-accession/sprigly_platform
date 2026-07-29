/**
 * draft-apply.ts — one client sentence in, a reshaped month and a receipt out.
 *
 * The north-star path, end to end:
 *   classify (the ONE model call) → apply named transforms → write rows → diff the
 *   before/after snapshots → persist the receipt.
 *
 * Only the first step involves a model. Everything after it is deterministic, which is
 * what makes the causality traceable: the client can be shown exactly what changed and
 * exactly which of their words caused it, and both claims are computed rather than
 * asserted.
 *
 * An input NEVER vanishes. If classification fails, if the intent cannot be applied, if
 * every beat is protected — the input lands in the backlog with a receipt saying so.
 * There is no path through this file where a client types something and nothing happens.
 */
import { and, eq, isNull } from 'drizzle-orm';
import {
  db, contentCycles, contentCyclePosts, planInputs,
  POST_STATUS_DRAFT, type BeatMeta, type NewContentCyclePostRow,
} from '@sprigly/db';
import {
  classifyIntake, applyIntent, diffBeats, renderDiff, isNoOp,
  isDocumentShaped, decomposeInput, orderIndices,
  type IntakeRouting, type MonthScopedIntent, type TransformBeat, type BeatOp, type DiffBeat,
} from '@sprigly/engine';
import { createAuditLogger } from '@sprigly/audit';
import { editScopeToday } from '@/lib/edit-scope';
import { cycleIsPreCutoff } from '@/lib/draft-mutations';
import { loadDraftBeats } from '@/lib/plan';
import type { DraftBeatView } from '@/lib/types';

/** How many receipts a cycle keeps. Enough to see the session's history, not a ledger. */
const MAX_RECEIPTS = 10;

/**
 * How the client said it (spec gap 8).
 *
 * `POST /api/plan/agent` and `POST /api/plan/intake` have accepted this since Build 3; the draft
 * route did not, so from the day the voice sheet shipped every spoken reshape would have been
 * recorded as typed and the one measurement that says whether talking to the plan works would
 * have been unavailable — retrofitted later against rows that no longer carry the answer.
 */
export type InputSource = 'web' | 'voice';

export interface DraftApplication {
  id:          string;
  at:          string;               // ISO timestamp
  sourceText:  string;               // the client's words, verbatim
  /** Spoken or typed. Absent on every receipt written before gap 8 closed — which reads as
   *  UNKNOWN, never as 'web'. Defaulting a null to typed would quietly under-count voice. */
  source?:     InputSource;
  scope:       'month_scoped' | 'evergreen';
  /** Why it went to the backlog. Present on evergreen only. */
  reason?:     string;
  /** Rendered diff lines. Empty on the evergreen path. */
  lines:       string[];
  /** Beats added or changed — the surface marks these until the next visit. */
  changedIds:  string[];
  /** A transform's explanation when it did less than asked (partial arc, nothing eligible). */
  note?:       string;
  /**
   * The backlog row this receipt filed, on the evergreen path.
   *
   * Carried so the receipt can offer the one-tap rescue Build C specified: without an id,
   * "add it to this month" has nothing to add. The server op (`add_to_month`) shipped and
   * the tap did not, so every evergreen receipt pointed the client at an ideas list with no
   * way back (docs/reports/uat-findings-fixes.md, Commit 4).
   */
  planInputId?: string;
  /** How many out-of-month dated asks this application deferred to next cycle (series). */
  deferredCount?: number;
  /**
   * A BRIEF ROLLUP: when the client pastes a document, one receipt stands for the whole
   * paste, with one item per decomposed segment. Present only on the rollup; a single-sentence
   * receipt leaves it undefined and renders exactly as before.
   */
  items?:          BriefItem[];
  /** Rollup only — segments found, and connective spans discarded. */
  segmentCount?:   number;
  discardedCount?: number;
}

/**
 * One segment of a decomposed brief, and what became of it. The per-application diff record
 * for that segment, preserved individually inside the rollup rather than flattened away.
 */
export interface BriefItem {
  /** The segment, verbatim (trimmed). */
  span:        string;
  /** applied = it changed the month · idea = filed to the backlog · couldnt_apply = tried,
   *  couldn't, filed with a rescue tap · noop = recorded, nothing to change (e.g. a cadence
   *  floor already met). */
  outcome:     'applied' | 'idea' | 'couldnt_apply' | 'noop';
  /** The intent kind, when it was month-scoped — drives the rollup summary ("1 launch"). */
  kind?:       string;
  lines:       string[];
  changedIds:  string[];
  note?:       string;
  planInputId?: string;
  deferredCount?: number;
}

export type ApplyResult =
  | { ok: true; application: DraftApplication; beats: DraftBeatView[] }
  | { ok: false; error: 'no_cycle' | 'cutoff_passed' | 'no_draft'; message: string };

const toTransformBeat = (r: { id: string; scheduledDate: string; format: string; pillar: string | null; position: number; beatMeta: BeatMeta | null; sourceMeta: Record<string, unknown> | null }): TransformBeat => ({
  id: r.id, date: r.scheduledDate, format: r.format, pillar: r.pillar ?? '',
  title: typeof r.sourceMeta?.['title'] === 'string' ? (r.sourceMeta['title'] as string) : (r.pillar ?? ''),
  position: r.position, beatMeta: r.beatMeta,
});

const toDiffBeat = (b: TransformBeat): DiffBeat => ({
  id: b.id, date: b.date, format: b.format, pillar: b.pillar, title: b.title,
});

/** Read the cycle's draft rows as transform inputs. */
async function loadTransformBeats(clientId: string, cycleId: string): Promise<TransformBeat[]> {
  const rows = await db
    .select({
      id: contentCyclePosts.id, scheduledDate: contentCyclePosts.scheduledDate,
      format: contentCyclePosts.format, pillar: contentCyclePosts.pillar,
      position: contentCyclePosts.position, beatMeta: contentCyclePosts.beatMeta,
      sourceMeta: contentCyclePosts.sourceMeta,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.cycleId, cycleId),
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.status, POST_STATUS_DRAFT),
      isNull(contentCyclePosts.deletedAt),
    ));
  return rows.map(toTransformBeat).sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);
}

/**
 * Execute a transform's ops in one transaction.
 *
 * All-or-nothing on purpose: a half-applied launch arc — three beats removed, one added —
 * would leave the client's month worse than before and with a receipt that does not
 * describe it.
 */
async function writeOps(clientId: string, cycleId: string, channel: string, ops: BeatOp[], nextPosition: number): Promise<void> {
  if (ops.length === 0) return;
  await db.transaction(async (tx) => {
    let position = nextPosition;
    for (const op of ops) {
      // Every write is scoped to (client, cycle, status='draft') — a committed post can
      // never be touched by an intake input, whatever a transform decides.
      const scope = and(
        eq(contentCyclePosts.clientId, clientId),
        eq(contentCyclePosts.cycleId, cycleId),
        eq(contentCyclePosts.status, POST_STATUS_DRAFT),
      );
      if (op.op === 'remove') {
        await tx.delete(contentCyclePosts).where(and(eq(contentCyclePosts.id, op.id), scope));
      } else if (op.op === 'update') {
        const set: Record<string, unknown> = {};
        if (op.changes.date   !== undefined) set['scheduledDate'] = op.changes.date;
        if (op.changes.format !== undefined) set['format'] = op.changes.format;
        if (op.changes.pillar !== undefined) set['pillar'] = op.changes.pillar;
        // A transform that rewrote the beat's evidence (an emphasis re-pillar) must have
        // that written too — otherwise the row keeps citing metrics for a pillar it no
        // longer has.
        if (op.beatMeta !== undefined) set['beatMeta'] = op.beatMeta;
        if (Object.keys(set).length > 0) {
          await tx.update(contentCyclePosts).set(set).where(and(eq(contentCyclePosts.id, op.id), scope));
        }
      } else {
        const row: NewContentCyclePostRow = {
          clientId, cycleId, channel,
          scheduledDate: op.date, format: op.format, pillar: op.pillar,
          caption: null, status: POST_STATUS_DRAFT, position: position++,
          beatMeta: op.beatMeta, sourceMeta: { title: op.title },
        };
        await tx.insert(contentCyclePosts).values(row);
      }
    }
  });
}

/** Append a receipt to the cycle's intake record.
 *
 *  Stored on content_cycles.intake_json rather than in a new table: it needs no migration,
 *  and a receipt IS part of the intake record — it is what happened to the month because
 *  of an intake input. A separate table would buy queryability nothing yet needs, at the
 *  cost of a migration and a join. Capped at MAX_RECEIPTS so the column cannot grow
 *  without bound. */
async function persistReceipt(cycleId: string, application: DraftApplication): Promise<void> {
  const [cycle] = await db
    .select({ intakeJson: contentCycles.intakeJson })
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);

  const intake = (cycle?.intakeJson ?? {}) as Record<string, unknown>;
  const prior = Array.isArray(intake['draftApplications']) ? (intake['draftApplications'] as DraftApplication[]) : [];
  const next = [application, ...prior].slice(0, MAX_RECEIPTS);

  await db.update(contentCycles)
    .set({ intakeJson: { ...intake, draftApplications: next } as unknown, updatedAt: new Date() })
    .where(eq(contentCycles.id, cycleId));
}

/**
 * Record a client-stated cadence FLOOR on the cycle's intake record.
 *
 * Stored on content_cycles.intake_json, not a new column: intake_json is ALREADY the cycle's
 * intake record (it holds the receipts), a cadence floor IS an intake instruction scoped to
 * this cycle, and the worker assembler reads it back from here on every re-assembly
 * (draft-plan.ts). A dedicated column would need a migration and buy queryability nothing yet
 * uses — this is the smallest honest home. `...intake` preserves the receipts alongside it.
 */
async function persistCadenceFloor(cycleId: string, intent: MonthScopedIntent, at: string): Promise<void> {
  const [cycle] = await db
    .select({ intakeJson: contentCycles.intakeJson })
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);
  const intake = (cycle?.intakeJson ?? {}) as Record<string, unknown>;
  const floor = {
    ...(typeof intent.postsPerWeek === 'number' ? { postsPerWeek: intent.postsPerWeek } : {}),
    ...(typeof intent.postsPerMonth === 'number' ? { postsPerMonth: intent.postsPerMonth } : {}),
    at, sourceText: intent.sourceText,
  };
  await db.update(contentCycles)
    .set({ intakeJson: { ...intake, cadenceFloor: floor } as unknown, updatedAt: new Date() })
    .where(eq(contentCycles.id, cycleId));
}

const describeStoredCadence = (i: MonthScopedIntent): string =>
  typeof i.postsPerWeek === 'number' ? `${i.postsPerWeek} posts a week`
  : typeof i.postsPerMonth === 'number' ? `${i.postsPerMonth} posts this month`
  : 'your cadence';

/** Read the receipts back, newest first. */
export async function loadReceipts(cycleId: string): Promise<DraftApplication[]> {
  const [cycle] = await db
    .select({ intakeJson: contentCycles.intakeJson })
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);
  const intake = (cycle?.intakeJson ?? {}) as Record<string, unknown>;
  return Array.isArray(intake['draftApplications']) ? (intake['draftApplications'] as DraftApplication[]) : [];
}

/** File an input in the ideas backlog. */
async function saveToBacklog(clientId: string, cycleId: string, sourceText: string, source: InputSource): Promise<string | undefined> {
  const [row] = await db.insert(planInputs).values({
    clientId,
    cycleId: null,                 // durable items are cycle-INDEPENDENT (see notes.ts)
    type: 'idea',
    content: sourceText,
    status: 'active',              // availability
    source,                        // transport: how they said it (gap 8)
    origin: 'client',              // where the idea came from (Build C)
    lifecycle: 'candidate',        // maturity (Build C)
  }).returning({ id: planInputs.id });
  void cycleId;                    // capture cycle deliberately not recorded on durables
  return row?.id;
}

/**
 * File the series instances that fall beyond this plan month.
 *
 * They are real asks with real dates ("Friday 4 September — long sleeve Orla"), so they keep
 * their date in `relevant_from`: filing them as undated ideas would lose exactly the part the
 * client was most specific about. `lifecycle: 'candidate'` matches the ordinary backlog, so
 * they surface in the same list and the existing rescue tap can pull them into next month.
 *
 * Best-effort by design: a backlog write that fails must not roll back beats that were
 * placed correctly. The receipt line still names them, so the client is told either way.
 */
async function saveDeferredInstances(
  clientId: string, deferred: ReadonlyArray<{ date: string; subject: string }>, source: InputSource,
): Promise<number> {
  if (deferred.length === 0) return 0;
  try {
    await db.insert(planInputs).values(deferred.map((d) => ({
      clientId,
      cycleId:      null,
      type:         'idea',
      content:      `${d.subject} (${d.date})`,
      relevantFrom: d.date,
      status:       'active',
      source,
      origin:       'client',
      lifecycle:    'candidate',
    })));
    return deferred.length;
  } catch { return 0; }
}

/** A stable-enough id for a receipt without pulling in a uuid dep on this path. */
const receiptId = (at: number, sourceText: string): string =>
  `r-${at.toString(36)}-${Math.abs([...sourceText].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36)}`;

/**
 * Apply one intake input to a cycle's draft.
 *
 * `routing` may be supplied by the caller (the "add to this month" path re-routes a
 * backlog item without re-classifying it); otherwise it is classified here.
 */
export async function applyIntakeToDraft(params: {
  clientId: string;
  cycleId:  string;
  text:     string;
  model:    Parameters<typeof classifyIntake>[0]['model'];
  /** Spoken or typed (gap 8). Defaults to 'web': every existing caller types. */
  source?:  InputSource;
  routing?: IntakeRouting;
  now?:     Date;
  today?:   string;
  /** Brief path: apply this ONE segment but do NOT persist its own top-level receipt — the
   *  caller rolls every segment into a single combined receipt. Beats, backlog rows and the
   *  cadence floor are still written; only the individual receipt is withheld. */
  suppressReceipt?: boolean;
}): Promise<ApplyResult> {
  const { clientId, cycleId, text, model } = params;
  const source: InputSource = params.source ?? 'web';
  const now = params.now ?? new Date();
  const today = params.today ?? editScopeToday();
  const sourceText = text.trim();

  const [cycle] = await db
    .select({ id: contentCycles.id, channel: contentCycles.channel, cycleMonth: contentCycles.cycleMonth })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
    .limit(1);
  if (!cycle) return { ok: false, error: 'no_cycle', message: 'We couldn’t find that month.' };

  const y = Number(cycle.cycleMonth.slice(0, 4)), m = Number(cycle.cycleMonth.slice(5, 7));
  const planMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;

  const routing = params.routing ?? await classifyIntake({ text: sourceText, planMonth, model });

  const base: Omit<DraftApplication, 'scope' | 'lines' | 'changedIds'> = {
    id: receiptId(now.getTime(), sourceText),
    at: now.toISOString(),
    sourceText,
    source,
  };

  // ── Evergreen ──────────────────────────────────────────────────────────────
  if (routing.scope === 'evergreen') {
    const planInputId = await saveToBacklog(clientId, cycleId, sourceText, source);
    const application: DraftApplication = {
      ...base, scope: 'evergreen', reason: routing.reason, lines: [], changedIds: [],
      ...(planInputId ? { planInputId } : {}),
    };
    if (!params.suppressReceipt) await persistReceipt(cycleId, application);
    return { ok: true, application, beats: await loadDraftBeats(clientId, cycleId) };
  }

  // ── Month-scoped ───────────────────────────────────────────────────────────
  // Editing a draft after cutoff is refused for the same reason the Build B mutations
  // refuse it: the month is being acted on and is no longer the client's to reshape.
  if (!(await cycleIsPreCutoff(cycleId))) {
    return { ok: false, error: 'cutoff_passed', message: 'This month’s draft is closed for changes.' };
  }

  // ── Cadence: record the floor, then top up a live draft ──────────────────────
  // A cadence is not a reshape of existing beats — it may ADD to reach a floor, and a
  // decrease legitimately changes nothing while still being recorded. So it does not share
  // the generic "no ops → backlog" path below: the floor is stored either way, and the client
  // is told, never filed as an idea.
  if (routing.intent.kind === 'cadence') {
    await persistCadenceFloor(cycleId, routing.intent, now.toISOString());
    const beforeC = await loadTransformBeats(clientId, cycleId);

    // Top up only a LIVE draft. With no draft yet, the floor is recorded for the worker
    // assembler and there is nothing to add to — assembling a month from zero here would
    // bypass the Build A history read the worker does properly.
    const result = beforeC.length > 0
      ? applyIntent(routing.intent, beforeC, planMonth, today)
      : { ops: [] as BeatOp[], note: `Recorded ${describeStoredCadence(routing.intent)} — I’ll hold your month to it when it’s drafted.` };

    if (result.ops.length > 0) {
      const nextPosition = Math.max(0, ...beforeC.map((b) => b.position)) + 1;
      await writeOps(clientId, cycleId, cycle.channel, result.ops, nextPosition);
      const afterC = await loadTransformBeats(clientId, cycleId);
      const diffC = diffBeats(beforeC.map(toDiffBeat), afterC.map(toDiffBeat));
      const application: DraftApplication = {
        ...base, scope: 'month_scoped', lines: renderDiff(diffC), changedIds: diffC.changedIds,
        ...(result.note ? { note: result.note } : {}),
      };
      if (!params.suppressReceipt) await persistReceipt(cycleId, application);
      return { ok: true, application, beats: await loadDraftBeats(clientId, cycleId) };
    }

    const application: DraftApplication = {
      ...base, scope: 'month_scoped', lines: [], changedIds: [],
      ...(result.note ? { note: result.note } : {}),
    };
    if (!params.suppressReceipt) await persistReceipt(cycleId, application);
    return { ok: true, application, beats: await loadDraftBeats(clientId, cycleId) };
  }

  const before = await loadTransformBeats(clientId, cycleId);
  if (before.length === 0) return { ok: false, error: 'no_draft', message: 'There’s no draft to change yet.' };

  const result = applyIntent(routing.intent as MonthScopedIntent, before, planMonth, today);

  // A transform that can do nothing files the input instead of dropping it. The client
  // typed something; it has to land somewhere they can see.
  if (result.ops.length === 0) {
    // A series whose every instance fell outside the month produced no ops but still has
    // dated asks to keep. File those as well as the input itself.
    const deferred0 = await saveDeferredInstances(clientId, result.deferred ?? [], source);
    const planInputId = await saveToBacklog(clientId, cycleId, sourceText, source);
    const application: DraftApplication = {
      ...base, scope: 'evergreen', reason: 'not_applicable', lines: [], changedIds: [],
      ...(result.note ? { note: result.note } : {}),
      ...(planInputId ? { planInputId } : {}),
      ...(deferred0 > 0 ? { deferredCount: deferred0 } : {}),
    };
    if (!params.suppressReceipt) await persistReceipt(cycleId, application);
    return { ok: true, application, beats: await loadDraftBeats(clientId, cycleId) };
  }

  const nextPosition = Math.max(0, ...before.map((b) => b.position)) + 1;
  await writeOps(clientId, cycleId, cycle.channel, result.ops, nextPosition);
  const deferred = await saveDeferredInstances(clientId, result.deferred ?? [], source);

  const after = await loadTransformBeats(clientId, cycleId);
  const diff = diffBeats(before.map(toDiffBeat), after.map(toDiffBeat));

  const application: DraftApplication = {
    ...base,
    scope: 'month_scoped',
    lines: renderDiff(diff),
    changedIds: diff.changedIds,
    ...(result.note ? { note: result.note } : {}),
    ...(deferred > 0 ? { deferredCount: deferred } : {}),
  };
  // A month-scoped intent that produced ops but no visible delta is worth recording as
  // such rather than showing an empty panel that implies something happened.
  if (isNoOp(diff) && !result.note) application.note = 'Nothing needed changing.';

  if (!params.suppressReceipt) await persistReceipt(cycleId, application);
  return { ok: true, application, beats: await loadDraftBeats(clientId, cycleId) };
}

/**
 * The one entry the route calls for a typed/pasted input.
 *
 * A pasted DOCUMENT (isDocumentShaped) goes through the decomposer; a single instruction takes
 * the existing whole-input path, byte-identical. Kept here rather than in the route so the route
 * does not import @sprigly/engine (whose index eagerly loads the db client).
 */
export async function applyTextToDraft(params: {
  clientId: string;
  cycleId:  string;
  text:     string;
  model:    Parameters<typeof classifyIntake>[0]['model'];
  /** Spoken or typed (gap 8). One field, and it rides both branches below unchanged. */
  source?:  InputSource;
  now?:     Date;
  today?:   string;
}): Promise<ApplyResult> {
  return isDocumentShaped(params.text.trim())
    ? applyBriefToDraft(params)
    : applyIntakeToDraft(params);
}

/** Map one segment's application result into a rollup item. */
function toBriefItem(span: string, routing: IntakeRouting, r: ApplyResult): BriefItem {
  const trimmed = span.trim();
  if (!r.ok) {
    // A cycle-level refusal on a single segment (rare — cutoff is checked up front).
    return { span: trimmed, outcome: 'couldnt_apply', lines: [], changedIds: [], note: r.message };
  }
  const a = r.application;
  const kind = routing.scope === 'month_scoped' ? routing.intent.kind : undefined;
  if (a.scope === 'evergreen') {
    const outcome: BriefItem['outcome'] =
      a.reason === 'couldnt_apply' || a.reason === 'not_applicable' ? 'couldnt_apply' : 'idea';
    return {
      span: trimmed, outcome, ...(kind ? { kind } : {}),
      lines: [], changedIds: [],
      ...(a.note ? { note: a.note } : {}),
      ...(a.planInputId ? { planInputId: a.planInputId } : {}),
      ...(a.deferredCount ? { deferredCount: a.deferredCount } : {}),
    };
  }
  const outcome: BriefItem['outcome'] = a.lines.length > 0 ? 'applied' : 'noop';
  return {
    span: trimmed, outcome, ...(kind ? { kind } : {}),
    lines: a.lines, changedIds: a.changedIds,
    ...(a.note ? { note: a.note } : {}),
    ...(a.deferredCount ? { deferredCount: a.deferredCount } : {}),
  };
}

/**
 * Apply a pasted DOCUMENT to a cycle's draft.
 *
 * Real clients paste briefs, not sentences. This splits the paste into VERBATIM segments (one
 * model call), classifies each through the UNMODIFIED contract, applies the month-scoped ones
 * in dependency order (launch → series → event/beat_spec → correction → emphasis → cadence
 * last), and returns ONE combined receipt with a line per segment. Each segment's own diff
 * record is preserved as a rollup item; the client sees the rollup.
 *
 * Partial failure is per-segment: a segment that cannot apply files itself to the backlog with
 * a rescue tap, and the rest proceed — never all-or-nothing. If decomposition fails the coverage
 * contract twice, it falls back to the whole-input path, which couldnt_applies exactly as today.
 */
export async function applyBriefToDraft(params: {
  clientId: string;
  cycleId:  string;
  text:     string;
  model:    Parameters<typeof classifyIntake>[0]['model'];
  /** Spoken or typed (gap 8) — a dictated brief is a real case, and a long one. */
  source?:  InputSource;
  now?:     Date;
  today?:   string;
}): Promise<ApplyResult> {
  const { clientId, cycleId, text, model } = params;
  const source: InputSource = params.source ?? 'web';
  const now = params.now ?? new Date();
  const today = params.today ?? editScopeToday();
  const brief = text.trim();

  const [cycle] = await db
    .select({ id: contentCycles.id, cycleMonth: contentCycles.cycleMonth })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
    .limit(1);
  if (!cycle) return { ok: false, error: 'no_cycle', message: 'We couldn’t find that month.' };

  const y = Number(cycle.cycleMonth.slice(0, 4)), m = Number(cycle.cycleMonth.slice(5, 7));
  const planMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;

  // Cutoff once, up front — it is a cycle fact, the same for every segment.
  if (!(await cycleIsPreCutoff(cycleId))) {
    return { ok: false, error: 'cutoff_passed', message: 'This month’s draft is closed for changes.' };
  }

  const audit = createAuditLogger(db);

  // Decompose. A coverage-contract failure (twice) falls back to the whole-input path.
  const decomposition = await decomposeInput({ text: brief, model, audit, clientId });
  if (!decomposition) {
    return applyIntakeToDraft({ clientId, cycleId, text: brief, model, now, today });
  }
  const { segments, discarded } = decomposition;

  // Classify every segment through the UNMODIFIED contract — concurrent, each on the ledger.
  // context:'brief_segment' gives the model the framing the split removed (a segment read in
  // isolation loses that it is a post request from a brief); the direct path never sets it.
  const routings = await Promise.all(
    segments.map((seg) => classifyIntake({ text: seg, planMonth, model, audit, clientId, context: 'brief_segment' })),
  );

  // Apply in dependency order; each segment's own receipt suppressed, rolled up below.
  const items: BriefItem[] = new Array<BriefItem>(segments.length);
  for (const i of orderIndices(routings)) {
    const r = await applyIntakeToDraft({
      clientId, cycleId, text: segments[i]!, model, source, routing: routings[i]!, now, today, suppressReceipt: true,
    });
    items[i] = toBriefItem(segments[i]!, routings[i]!, r);
  }

  const changedIds = items.flatMap((it) => it.changedIds);
  const rollup: DraftApplication = {
    id: receiptId(now.getTime(), brief),
    at: now.toISOString(),
    sourceText: brief,
    source,
    scope: items.some((it) => it.outcome === 'applied') ? 'month_scoped' : 'evergreen',
    lines: [],
    changedIds,
    segmentCount: segments.length,
    discardedCount: discarded.length,
    items,
  };
  await persistReceipt(cycleId, rollup);
  return { ok: true, application: rollup, beats: await loadDraftBeats(clientId, cycleId) };
}

/**
 * Promote a backlog idea into this month.
 *
 * Re-routes through the SAME transform path as a typed input — it is applied as an event
 * so it lands on a date and displaces the weakest beat, exactly as if the client had just
 * written it. The plan_inputs row is marked used and bound to the cycle that consumed it,
 * which is what used_in_cycle_id exists for.
 */
export async function addBacklogItemToMonth(params: {
  clientId: string; cycleId: string; planInputId: string; date: string;
  model: Parameters<typeof classifyIntake>[0]['model'];
  now?: Date; today?: string;
}): Promise<ApplyResult> {
  const { clientId, cycleId, planInputId, date } = params;

  const [row] = await db
    .select({ id: planInputs.id, content: planInputs.content })
    .from(planInputs)
    .where(and(eq(planInputs.id, planInputId), eq(planInputs.clientId, clientId)))
    .limit(1);
  if (!row) return { ok: false, error: 'no_cycle', message: 'We couldn’t find that idea.' };

  const intent: MonthScopedIntent = {
    kind: 'event',
    subject: row.content.split(/\n/)[0]?.slice(0, 80) ?? row.content.slice(0, 80),
    sourceText: row.content,
    dateRange: { start: date, end: date },
  };

  const applied = await applyIntakeToDraft({
    ...params, text: row.content,
    routing: { scope: 'month_scoped', intent, sourceText: row.content },
  });

  if (applied.ok && applied.application.scope === 'month_scoped') {
    await db.update(planInputs)
      .set({ lifecycle: 'used', usedInCycleId: cycleId })
      .where(and(eq(planInputs.id, planInputId), eq(planInputs.clientId, clientId)));
  }
  return applied;
}
