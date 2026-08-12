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
  db, contentCycles, contentCyclePosts, planInputs, clearStructuredBriefIfPrePlanning,
  POST_STATUS_DRAFT, retireDraftPosts, type BeatMeta, type NewContentCyclePostRow,
} from '@sprigly/db';
import {
  classifyIntake, applyIntent, diffBeats, renderDiff, isNoOp,
  isDocumentShaped, decomposeInput, orderIndices, namesAnOperation, briefArcDatesFor,
  type IntakeRouting, type MonthScopedIntent, type TransformBeat, type BeatOp, type DiffBeat,
} from '@sprigly/engine';
import { createAuditLogger } from '@sprigly/audit';
import { editScopeToday } from '@/lib/edit-scope';
import { cycleIsPreCutoff, pillarVocab } from '@/lib/draft-mutations';
import { loadDraftBeats } from '@/lib/plan';
import { monthLabel, monthWindow, monthNamedIn } from '@/lib/agent/cycle-state';
import { listIdeas } from '@/lib/agent/ideas';
import { answerIdeasQuestion, answerPlanQuestion, datesNamedIn } from '@/lib/plan-answers';
import { buildPlanContext } from '@/lib/agent/plan-context';
import { answerQuery } from '@/lib/agent/query';
import { getEmbeddingClient, getModelClient } from '@/lib/agent/model';
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
  scope:       'month_scoped' | 'evergreen' | 'question';
  /** Why it went to the backlog. Present on evergreen only. */
  reason?:     string;
  /** Rendered diff lines. Empty on the evergreen path; the ANSWER on the question path, which
   *  is why the surface can render both from one field — a receipt is what the agent said. */
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
  /**
   * applied        it changed the month
   * idea           filed to the backlog, as asked
   * couldnt_apply  we tried and failed; filed with a rescue tap
   * nothing_to_do  the transform RAN and there was nothing to change — a cadence floor already
   *                met, an emphasis the month already satisfies — and the input was filed.
   *                Split out of `couldnt_apply`, where it was giving a success the copy of a
   *                failure: *"Recorded 7 posts a week as your floor. You have 9 posts this
   *                month"* is not something we could not apply.
   * noop           recorded, nothing to change, and nothing filed either.
   */
  outcome:     'applied' | 'idea' | 'couldnt_apply' | 'nothing_to_do' | 'noop';
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
        // Purge if nothing references it, tombstone if post_edits does — the FK refuses a hard
        // delete of a referenced post, and that FK is the billing ledger's and the regen's
        // protection, not an obstacle to route around. See retireDraftPosts.
        //
        // Not dropBeat's rule, which always tombstones so its undo has a row to un-drop. A
        // transform's remove has no undo, so an unreferenced beat is purged rather than left
        // to accumulate.
        await retireDraftPosts(tx, { cycleId, clientId, postIds: [op.id] });
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

/**
 * Append one sentence to a cycle's running free-text brief.
 *
 * `\n\n` because that is what the intake route's `mergeIntake` uses, and two writers of one
 * field that disagree about its separator is how a brief comes apart. APPENDS — a second
 * sentence must never delete the first.
 *
 * IDEMPOTENT on the exact sentence. A client who says the same thing twice, a double-tapped
 * send, or a retried request must not double the text the generator reads: the brief is
 * repeated verbatim into every caption prompt for the month, so a duplicate is not merely
 * untidy, it is emphasis nobody asked for.
 *
 * Pure and exported so the rule is testable without a database — the wrapper below is only
 * the read, the write and the brief invalidation.
 */
export function mergeFreeNotes(current: string, addition: string): string {
  const cur = current.trim();
  const add = addition.trim();
  if (!add) return cur;
  if (cur.split('\n\n').some((p) => p.trim() === add)) return cur;
  return cur ? `${cur}\n\n${add}` : add;
}

/**
 * ── THE SINK THE GENERATOR ACTUALLY READS ────────────────────────────────────────────
 *
 * Every `client_input` transform writes the client's sentence to
 * `beat_meta.rationaleEvidence.reason`, and NOTHING downstream of the receipt reads it. The
 * caption generator's per-post brief is `captionInstruction(title, pillar)` and its
 * cycle-level text is `intake_json.planContent.freeNotes` — which was empty on Ivy T's
 * September while three live "Molly" beats carried the client's launch sentence in
 * `beat_meta` where generation would never see it.
 *
 * So month-scoped context that names nothing to place lands HERE instead. The read path,
 * confirmed end to end:
 *
 *   intake_json.planContent.freeNotes
 *     → assembleShapeContext            planning.ts:471   (read live, per shape job)
 *     → buildPlanningUserMessage        planning.ts:289   ("FREE NOTES:\n…")
 *     → ctx.userMessage
 *     → regeneratePost's fixMessage     plan-validation.ts:358  (its FIRST line)
 *     → Bedrock
 *
 * and separately into `intakeText`, which ranks the catalogue grounding block (planning.ts:501).
 *
 * APPENDS, never replaces, and with the SAME `\n\n` join the intake route's `mergeIntake`
 * uses — a second brief must not silently delete the first, and two writers of one field
 * that disagree about its format is how a month's brief comes apart. Everything else under
 * `planContent` is preserved: this path has no answers to contribute and must not blank the
 * ones the intake route collected.
 *
 * The structured brief is cleared afterwards for the reason `clearStructuredBriefIfPrePlanning`
 * states: `ensureStructuredBrief` returns the persisted brief and never re-extracts, so a
 * brief left in place would be the extraction of an intake that no longer exists. It is a
 * no-op at or after 'planning', which is exactly right — a month being generated must not
 * have its brief pulled out from under it.
 */
async function appendMonthContext(cycleId: string, sentence: string, source: InputSource): Promise<string> {
  const text = sentence.trim();
  const [cycle] = await db
    .select({ intakeJson: contentCycles.intakeJson })
    .from(contentCycles)
    .where(eq(contentCycles.id, cycleId))
    .limit(1);

  const intake = (cycle?.intakeJson ?? {}) as Record<string, unknown>;
  const planContent = (intake['planContent'] ?? {}) as { answers?: Record<string, string>; freeNotes?: string };
  const current = (planContent.freeNotes ?? '').trim();
  const merged = mergeFreeNotes(current, text);
  if (merged === current) return merged;

  await db.update(contentCycles)
    .set({
      intakeJson: {
        ...intake,
        planContent: { answers: planContent.answers ?? {}, freeNotes: merged },
        // Provenance for the same reason the receipts carry it (gap 8): a brief that arrived
        // by voice on the draft surface and one typed into the Ask email are different acts.
        source: source === 'voice' ? 'voice' : 'manual',
        capturedAt: new Date().toISOString(),
      } as unknown,
      updatedAt: new Date(),
    })
    .where(eq(contentCycles.id, cycleId));

  // Best-effort, and deliberately AFTER the write it invalidates: losing the sentence is
  // worse than leaving a stale brief, which the next intake write would clear anyway.
  try { await clearStructuredBriefIfPrePlanning(db, cycleId); } catch { /* never fail the capture */ }
  return merged;
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

/**
 * The relevance window a filed input keeps — the same window the agent path gives a note (F5).
 *
 * Preference order, and it is about PROVENANCE. A `dateRange` is a span the classifier already
 * extracted from the client's words; a month read back out of the prose is our own reading of
 * them. Where the parsed one exists it wins, because re-deriving something already known is
 * precisely how two readings of one sentence start to disagree.
 *
 * Neither is available on most trips through here — an evergreen verdict carries only the source
 * text and a reason — so the prose read is what covers the case this exists for: "October idea:
 * TV Halloween theme", filed with October surviving nowhere but the sentence.
 */
function backlogWindow(routing: IntakeRouting, sourceText: string, today: string): { from: string | null; to: string | null } {
  if (routing.scope === 'month_scoped' && routing.intent.dateRange) {
    return { from: routing.intent.dateRange.start, to: routing.intent.dateRange.end };
  }
  return monthWindow(monthNamedIn(sourceText, today.slice(0, 7)));
}

/**
 * File an input in the ideas backlog.
 *
 * `relevant` is the WINDOW, and everything else about the row is deliberately unchanged: a
 * backlog item is still `type: 'idea'`, `origin: 'client'`, `lifecycle: 'candidate'` and
 * `cycleId: null`. That shape is what keeps these rows in `DURABLE_INPUT_TYPES` and out of
 * cycle binding, and a window is a filter applied to durables — not a step away from being one.
 */
async function saveToBacklog(
  clientId: string, cycleId: string, sourceText: string, source: InputSource,
  relevant: { from: string | null; to: string | null },
): Promise<string | undefined> {
  const [row] = await db.insert(planInputs).values({
    clientId,
    cycleId: null,                 // durable items are cycle-INDEPENDENT (see notes.ts)
    type: 'idea',
    content: sourceText,
    relevantFrom: relevant.from,   // the month they named, kept as a window rather than as prose
    relevantTo: relevant.to,
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

/**
 * THE DRAFT MONTH'S QUESTIONS, ANSWERED BY THE ANSWERER THE COMMITTED MONTH USES.
 *
 * ── What this closes ─────────────────────────────────────────────────────────────────
 *
 * On a draft month `PlanRoot` renders `DraftSurface`, whose only send path is
 * `POST /api/plan/draft/apply` — this file. `answerQuery` is reachable only through
 * `runPlanAgentTurn`, which that surface cannot reach. So for the whole review window, the one
 * stretch in which the client is actually asking questions, every grounded fact the answerer
 * was given was invisible to them: the PLAN FACTS block, the stated week windows, the
 * cross-month span, the prompt cache. Measured live on September:
 *
 *   "what's on next week?"          → a 27-line dump of the whole month
 *   "what's in September?"          → the same dump
 *   "which post is just an image?"  → the same dump again
 *
 * and the harness, calling `answerQuery` against the SAME cycle, answered the first one exactly
 * (five posts, 31 Aug – 6 Sep, split written from planned). Two paths, one plan, different
 * answers — which is the divergence that hid all of this.
 *
 * ── `answerPlanQuestion` IS NOT DELETED, IT IS THE FLOOR ─────────────────────────────
 *
 * It stays, and it stays as the fallback, because it is the one answerer here that cannot be
 * wrong: it reads the beats back. A Bedrock outage must not turn a question into an error on a
 * surface whose entire job this month is to be asked questions, and "the whole month, listed"
 * is a worse answer than the model's but a far better one than a failure. So the model is
 * tried, and its floor is the behaviour that shipped before it.
 *
 * The 'ideas' half of the branch is untouched. `answerIdeasQuestion` derives its answer from
 * lifecycle rows — *"None of your ideas went into September. One is still waiting"* — and a
 * model has nothing to add to a fact that is already exact.
 *
 * ── COST, STATED ────────────────────────────────────────────────────────────────────
 *
 * This branch was free: `parsePlanQuestion` claims the question inside `classifyIntake` BEFORE
 * its model call, so a question spent nothing at all. It now costs one Titan embed and one
 * Haiku answer — measured at ~2.5s per question against this cycle, with the prompt prefix
 * caching (cacheRead 5,889 tokens observed). That is a pause on a path the client is typing
 * into, and it is covered: `useDraftMonth.say()` already raises `shaping`, which is what the
 * shell renders the agent's working dots from. No new loading state, because the one that
 * exists already wraps this call.
 */
/*
 * It takes NO model argument, and that is a type telling the truth rather than a shortcut.
 * `params.model` on this path is typed off `classifyIntake`, which asks only for `complete()`;
 * `answerQuery` requires the full `ModelClient`, streaming included. Threading the narrower
 * value in and widening it would be a claim the caller never made. `getModelClient()` is the
 * same value the route already passes (apply/route.ts:78) and is also the e2e-fake seam, so
 * nothing about test isolation changes.
 */
async function answerAboutThePlan(a: {
  clientId: string; cycleId: string; sourceText: string; today: string;
  planMonth: string; monthName: string;
}): Promise<string[]> {
  const floor = async () => answerPlanQuestion({
    beats: await loadDraftBeats(a.clientId, a.cycleId),
    monthLabel: a.monthName,
    dates: datesNamedIn(a.sourceText, a.planMonth),
  });

  try {
    const context = await buildPlanContext(a.clientId, a.cycleId, a.today);
    const res = await answerQuery(
      { clientId: a.clientId, cycleId: a.cycleId, question: a.sourceText, today: new Date(`${a.today}T00:00:00`), context },
      // The auditor is passed, unlike the diagnostics in scripts/: this is the product path, and
      // a query turn here spends exactly what a query turn on the committed surface spends. A
      // path that spends without a ledger row is how the draft surface's classify call went
      // unbilled for a month (:470).
      { model: getModelClient(), embeddingClient: getEmbeddingClient(), audit: createAuditLogger(db) },
    );
    // Split on the model's own newlines. `agentLines` (agent-prose.ts) re-splits and strips the
    // markdown when the thread renders it, so this is lossless in both directions — and it is
    // what makes the answer a list of lines for the receipt without inventing a shape for it.
    const lines = res.text.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length ? lines : await floor();
  } catch {
    // Retrieval, Bedrock, or the context builder. The question still gets an answer.
    return floor();
  }
}

/**
 * THE ONE PLACE THAT DECIDES A FILING MIGHT BE A MISREAD.
 *
 * `classified_evergreen` means the model actively called the sentence a standing idea, and
 * `ambiguous` means its intent failed validation. Both file the input and both used to render
 * as a filing the client had asked for. Neither can be PROVEN a misread — the classifier is the
 * only reader of intent in the system and it is the one that failed.
 *
 * What is available is a second, deterministic reader that already ran on the same string:
 * gate 3 in `parsePlanQuestion`. When it says REQUEST and the model says IDEA, they disagree,
 * and `namesAnOperation` narrows that disagreement to sentences acting on a post that already
 * exists — where a filing is almost certainly wrong and, more to the point, where the rescue tap
 * would do damage. Measured: both reported misreads, none of the twenty genuinely-evergreen
 * corpus inputs.
 *
 * Computed HERE rather than in the engine because it is a decision about what the RECEIPT says,
 * not about where the input goes. The routing is untouched: the row is filed exactly as before,
 * in the same place, with the same window. Only the sentence the client reads changes.
 */
export function readAsIdea(reason: string, sourceText: string): string {
  const uncertain = reason === 'classified_evergreen' || reason === 'ambiguous';
  return uncertain && namesAnOperation(sourceText) ? 'read_as_idea' : reason;
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
  /**
   * The structured brief the SAME request just extracted (content_cycles.structured_brief).
   *
   * The extractor is the careful reader of the two model passes a save runs: it resolves the
   * client's vague timing and dates every beat, and until now it wrote that to a column
   * nothing on this path read, while `classifyIntake` re-derived a date from raw text and
   * placed the month from it. This is that answer, handed over rather than re-earned — no
   * third model call.
   *
   * OPTIONAL, and unknown-typed, because it is allowed to be missing: the extraction runs
   * inside a 25s race and returns null on timeout or malformed output. Absent or partial
   * degrades to exactly the previous behaviour.
   */
  brief?: unknown;
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

  // On the ledger, like the brief path's segments are (:553). This is the SINGLE-INPUT reshape
  // branch, and it was the one classify call in the product that spent Bedrock without leaving a
  // row — not because it was exempt, but because `classifyIntake`'s auditor is optional and this
  // caller never passed one. `params.routing` short-circuits it (the "add to this month" path
  // re-routes a backlog item without re-classifying), and that path spends nothing to log.
  const routing = params.routing
    ?? await classifyIntake({ text: sourceText, planMonth, model, audit: createAuditLogger(db), clientId });

  const base: Omit<DraftApplication, 'scope' | 'lines' | 'changedIds'> = {
    id: receiptId(now.getTime(), sourceText),
    at: now.toISOString(),
    sourceText,
    source,
  };

  // ── A question — answered, never filed ─────────────────────────────────────
  //
  // This branch sits ABOVE evergreen deliberately. Evergreen is the catch-all, and a question
  // reaching a catch-all is exactly how "what ideas of mine are in this month" got recorded as
  // a new idea four times in a row. Nothing here writes: no backlog row, no beat, no cadence
  // floor. The receipt is persisted so the answer survives a reload like every other turn, and
  // it carries `changedIds: []` because nothing changed — which is the whole claim.
  if (routing.scope === 'question') {
    const monthName = monthLabel(planMonth);
    const lines = routing.kind === 'ideas'
      ? answerIdeasQuestion({ ideas: await listIdeas(clientId), cycleId, monthLabel: monthName })
      : await answerAboutThePlan({ clientId, cycleId, sourceText, today, planMonth, monthName });
    const application: DraftApplication = {
      ...base, scope: 'question', lines, changedIds: [],
    };
    if (!params.suppressReceipt) await persistReceipt(cycleId, application);
    return { ok: true, application, beats: await loadDraftBeats(clientId, cycleId) };
  }

  // ── Evergreen ──────────────────────────────────────────────────────────────
  if (routing.scope === 'evergreen') {
    const planInputId = await saveToBacklog(clientId, cycleId, sourceText, source, backlogWindow(routing, sourceText, today));
    const application: DraftApplication = {
      ...base, scope: 'evergreen', reason: readAsIdea(routing.reason, sourceText), lines: [], changedIds: [],
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

  /**
   * THE PILLAR VOCABULARY, for the emphasis branch.
   *
   * `applyEmphasis` used to test the client's phrase for EQUALITY against a pillar name and
   * write the phrase itself into the `pillar` column when it matched nothing — which was
   * every phrase that was not literally a pillar name. It now resolves the phrase to a
   * pillar and writes the CANONICAL name, and this is the list it resolves against: the same
   * one `addBeat` validates against (`draft-mutations.ts:pillarVocab`), so the two cannot
   * disagree about what a pillar is.
   *
   * Read only for the kind that uses it — every other intent ignores it, and an emphasis is
   * a small share of inputs. A failed read degrades to the month's own pillars rather than
   * failing the reshape: a narrower match is a worse answer, an aborted one is no answer.
   */
  const clientPillars = routing.intent.kind === 'emphasis'
    ? await pillarVocab(clientId, cycle.channel).catch(() => [])
    : [];

  /**
   * ── THE EXTRACTOR'S DATES WIN, WHERE IT HAS ANY FOR THIS SUBJECT ─────────────────
   *
   * `classifyIntake` reads one segment in isolation and guesses a date from it.
   * `extractStructuredBrief` read the WHOLE brief, resolved the vague timing, and dated the
   * same beat properly — and the two disagreed by a week on ivy-t's Hannah launch, with the
   * worse answer winning because it was the only one this path could see.
   *
   * Matched on product name (briefArcDatesFor explains why that is the only reliable key).
   * A subject the brief has no dated entry for returns `{}` and nothing below changes, which
   * is every product-less single post — and those are the ones the classifier already gets
   * right, because their segment says the date in words.
   */
  const arc = briefArcDatesFor(params.brief, routing.intent.subject);
  const intent = arc.launch
    ? { ...(routing.intent as MonthScopedIntent), dateRange: { start: arc.launch, end: arc.launch } }
    : (routing.intent as MonthScopedIntent);

  const result = applyIntent(intent, before, planMonth, today, clientPillars);

  /**
   * ── CONTEXT FOR THIS MONTH, NOT AN IDEA FOR LATER ────────────────────────────────
   *
   * Zero ops with `context` is a THIRD outcome, and it needed to be: filing it as evergreen
   * would tell the client "saved to your ideas" about a sentence they plainly said was about
   * September, and applying it as month_scoped would claim a change that did not happen.
   *
   * It is month_scoped because it DID act on the month — on what its captions will say
   * rather than on which posts exist — and `changedIds` is empty because no row moved. No
   * backlog row is written: this is not something to promote into the month later, it is
   * already in the month's brief. That is also why it keeps no `planInputId`; the rescue tap
   * would offer to add something that is already there.
   */
  if (result.ops.length === 0 && result.context) {
    await appendMonthContext(cycleId, result.context, source);
    const application: DraftApplication = {
      ...base, scope: 'month_scoped', lines: [], changedIds: [],
      ...(result.note ? { note: result.note } : {}),
    };
    if (!params.suppressReceipt) await persistReceipt(cycleId, application);
    return { ok: true, application, beats: await loadDraftBeats(clientId, cycleId) };
  }

  // A transform that can do nothing files the input instead of dropping it. The client
  // typed something; it has to land somewhere they can see.
  if (result.ops.length === 0) {
    // A series whose every instance fell outside the month produced no ops but still has
    // dated asks to keep. File those as well as the input itself.
    const deferred0 = await saveDeferredInstances(clientId, result.deferred ?? [], source);
    const planInputId = await saveToBacklog(clientId, cycleId, sourceText, source, backlogWindow(routing, sourceText, today));
    const application: DraftApplication = {
      // TWO EVENTS, TWO REASONS. A zero-op result is either "understood, nothing to do" — a
      // cadence floor already met — or "could not work out what you meant", and they had been
      // sharing `not_applicable` and therefore one heading. `unresolved` is the transform saying
      // which; see TransformResult. The note's wording is deliberately NOT the signal.
      ...base, scope: 'evergreen', reason: result.unresolved ? 'unclear' : 'not_applicable',
      lines: [], changedIds: [],
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
  /** The structured brief this request already extracted — see applyIntakeToDraft. */
  brief?: unknown;
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
    // `not_applicable` used to be folded in with `couldnt_apply` here, which is the inconsistency
    // that gave one failure honest copy in a brief and dishonest copy in a sentence — and it was
    // honest in the WRONG direction: a cadence floor already met is a success, not a failure. The
    // two now say the same thing on both paths.
    const outcome: BriefItem['outcome'] =
      a.reason === 'couldnt_apply' || a.reason === 'validation_failed' ? 'couldnt_apply'
      : a.reason === 'not_applicable' ? 'nothing_to_do'
      : 'idea';
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
  /** The structured brief this request already extracted — see applyIntakeToDraft. Threaded
   *  to every segment: the schedule was extracted from the whole brief, so a segment's dates
   *  may well have been resolved from a sentence in a DIFFERENT segment ("the week before"
   *  needs the launch the other half named). */
  brief?: unknown;
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
    return applyIntakeToDraft({ clientId, cycleId, text: brief, model, now, today, brief: params.brief });
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
      brief: params.brief,
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
