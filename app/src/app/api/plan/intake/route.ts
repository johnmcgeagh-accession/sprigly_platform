/**
 * POST /api/plan/intake — the client intake capture route + the pre/post-cutoff CLASSIFIER.
 *
 * Body: { cycleId, answers?: Record<questionText,string>, freeNotes?, durableItems?:
 *         [{type:'idea'|'next_cycle', text}], source: 'web'|'voice', sessionId? }.
 *
 * The cycle is validated to belong to the session's client. Then:
 *   - PRE-cutoff (cycle.status ∈ PRE_PLANNING_STATUSES): MERGE answers/freeNotes into
 *     intake_json.planContent (new answers overwrite same-question keys; freeNotes appends
 *     with a blank-line separator) and clear the persisted structured_brief so it re-extracts.
 *   - POST-cutoff (planning or later): intake_json is NOT touched. The answers/freeNotes are
 *     rendered into an instruction and run through runPlanAgentTurn — the SAME parse→propose
 *     loop the agent route uses — so the info lands in the agent_proposals approve/apply queue.
 *   - durableItems ALWAYS write to plan_inputs (type idea|next_cycle, cycle-independent),
 *     regardless of cutoff.
 * Voice: source='voice' + sessionId are accepted exactly as the agent route accepts them
 * (same transport; destination is intake/brief, not proposals, pre-cutoff).
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, contentCycles, clearStructuredBriefIfPrePlanning, PRE_PLANNING_STATUSES } from '@sprigly/db';
import { createAuditLogger } from '@sprigly/audit';
import { extractStructuredBrief, distributeBriefAnswers, loadDurableInputs, BASE_QUESTIONS, type IntakeJson, type StructuredBrief, type CurrentPlanBeat } from '@sprigly/engine';
import type { DraftBeatView, ExtractedSummary } from '@/lib/types';
// The ONLY sanctioned reader of draft rows (plan.ts) — the brief is extracted against the month
// as it currently stands, so a sentence naming a date resolves against what is already there.
import { loadDraftBeats } from '@/lib/plan';
// The additive reshape path. Deliberately NOT assembly: see the call site for why a brief may
// never run the day-1 assembler over a month the client has already touched.
import { applyBriefToDraft, type DraftApplication } from '@/lib/draft-apply';
// The save path and the LATER page loads describe a brief with the same sentences — see
// brief-summary.ts for why that is one definition and not two.
import { summariseBrief } from '@/lib/brief-summary';
import { recordActivity, USER_ACTOR } from '@/lib/activity';
import { getSession } from '@/lib/auth';
import { allowRequest } from '@/lib/rate-limit';
import { saveDurableInput } from '@/lib/agent/notes';
import { runPlanAgentTurn } from '@/lib/agent/turn';
import { getModelClient } from '@/lib/agent/model';
import { nextMonth } from '@/lib/cycle-nav';

/** ms budget for the inline brief extraction (one Sonnet call). On timeout the intake is still
 *  saved and the brief is left null for the lazy planning-path retry. */
const EXTRACT_TIMEOUT_MS = 25_000;

/** Live durable cross-cycle context for the plan month — the SHARED @sprigly/engine
 *  loadDurableInputs (one query construction, the same the planning gate and worker generator
 *  call). Best-effort posture unchanged: any failure yields []. */
async function loadDurableContext(clientId: string, planMonth: string): Promise<string[]> {
  try {
    const rows = await loadDurableInputs(db, clientId, planMonth);
    return rows.map((r) => `[${r.type}] ${r.content}`);
  } catch { return []; }
}

/**
 * The month as it currently stands, for the extractor's CURRENT PLAN section.
 *
 * Best-effort on the same terms as `loadDurableContext` above: a failed read costs the
 * extraction its context, never the client's save. Returns the full `DraftBeatView` because the
 * caller needs BOTH facts this read carries — the titles and dates the extractor is given, and
 * whether there is a draft here to reshape at all. One read, one answer to "what is on this
 * month"; two would be two answers, and they would drift.
 */
async function loadCurrentPlan(clientId: string, cycleId: string): Promise<DraftBeatView[]> {
  try { return await loadDraftBeats(clientId, cycleId); } catch { return []; }
}

/** Project draft beats down to what the extractor is allowed to see: title and date. */
const asPlanState = (beats: readonly DraftBeatView[]): CurrentPlanBeat[] =>
  beats.map((b) => ({ date: b.date, title: b.title }));

/**
 * The submission rendered as ONE instruction: answered questions first, then the free notes.
 *
 * Extracted because two branches of this route now need it — the post-cutoff agent turn has
 * built this string inline since Build 3, and the pre-cutoff draft reshape needs exactly the
 * same thing. Two inline copies of "the brief, as one instruction" is two definitions of what
 * the client said, and they would drift the first time either side gained a field.
 *
 * THE SUBMISSION, not the merged brief. `next.planContent` holds everything the client has ever
 * said about this month; applying that would re-apply the whole history on every save. What
 * reshapes the month is what they just typed — which is also why the composer opens empty on a
 * draft month (IntakeCapture), so the two halves of that rule are stated in both places.
 */
function briefInstruction(answers: Record<string, string>, freeNotes: string): string {
  const lines: string[] = [];
  for (const [q, a] of Object.entries(answers)) if (a.trim()) lines.push(`${q} — ${a.trim()}`);
  if (freeNotes.trim()) lines.push(freeNotes.trim());
  return lines.join('\n');
}

/**
 * FIX 2 — extract the structured brief inline and persist it, so beats appear immediately after
 * Send. The intake_json is already SAVED before this runs, so a failed/slow/malformed extraction
 * never loses the brief: on any error we return false and leave structured_brief null (the
 * extract-gate's fail-loud validation still applies — a malformed brief is never persisted), and
 * the lazy planning-path re-extracts later. Returns whether beats are now ready.
 */
async function extractAndPersistBrief(
  cycleId: string, cycleMonth: string, intake: IntakeJson, clientId: string,
  /** The month as it stands RIGHT NOW — read by the caller before any reshape, so the brief is
   *  interpreted against the state the client was looking at when they wrote it. */
  currentPlan: readonly CurrentPlanBeat[] = [],
): Promise<StructuredBrief | null> {
  try {
    const planMonth = nextMonth(cycleMonth);
    const durableContext = await loadDurableContext(clientId, planMonth);
    const brief = await Promise.race([
      extractStructuredBrief({
        planContent: intake.planContent, planMonth, model: getModelClient(), clientId, durableContext,
        currentPlan,
        // The heaviest single call on this route (one Sonnet extraction of the whole brief) and
        // it was leaving no row. `extractStructuredBrief` has taken an auditor all along and
        // logs behind `if (audit && clientId)` — clientId was already being passed; the auditor
        // never was, so the guard silently never fired.
        audit: createAuditLogger(db),
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('extract timeout')), EXTRACT_TIMEOUT_MS)),
    ]);
    await db.update(contentCycles).set({ structuredBrief: brief as unknown, updatedAt: new Date() }).where(eq(contentCycles.id, cycleId));
    return brief as StructuredBrief;
  } catch {
    return null;   // intake is saved; brief stays null for the lazy retry
  }
}

/** Distribute the running free-text brief across empty base-question slots (non-fatal + timeboxed).
 *  Fills ONLY answer slots that are currently empty, so an explicit (guided-mode) answer is never
 *  clobbered; the free text remains the source of truth for extraction either way. */
async function distributeIntoEmptyAnswers(intake: IntakeJson, questions: string[], clientId: string): Promise<void> {
  try {
    const distributed = await Promise.race([
      distributeBriefAnswers({
        freeNotes: intake.planContent.freeNotes, questions, model: getModelClient(), clientId,
        audit: createAuditLogger(db),
      }),
      new Promise<Record<string, string>>((resolve) => setTimeout(() => resolve({}), EXTRACT_TIMEOUT_MS)),
    ]);
    for (const [q, a] of Object.entries(distributed)) {
      if (!intake.planContent.answers[q]?.trim()) intake.planContent.answers[q] = a;
    }
  } catch { /* non-fatal: leave answers as they are */ }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DurableItem = { type: 'idea' | 'next_cycle'; text: string };

function parseBody(b: Record<string, unknown>) {
  const cycleId = typeof b.cycleId === 'string' ? b.cycleId : '';
  const answersRaw = (b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers)) ? b.answers as Record<string, unknown> : {};
  const answers: Record<string, string> = {};
  for (const [q, a] of Object.entries(answersRaw)) if (typeof a === 'string') answers[q] = a;
  const freeNotes = typeof b.freeNotes === 'string' ? b.freeNotes : '';
  const source: 'web' | 'voice' = b.source === 'voice' ? 'voice' : 'web';
  const sessionId = typeof b.sessionId === 'string' ? b.sessionId : undefined;
  const durableItems: DurableItem[] = Array.isArray(b.durableItems)
    ? b.durableItems.flatMap((it) => {
        const o = it as Record<string, unknown>;
        const type = o?.type === 'next_cycle' ? 'next_cycle' : o?.type === 'idea' ? 'idea' : null;
        const text = typeof o?.text === 'string' ? o.text.trim() : '';
        return type && text ? [{ type, text }] : [];
      })
    : [];
  // The client sends its question list (BASE + this channel's extra_questions) so the freeform
  // brief can be distributed into the same answer slots the generator + admin read. Fall back to
  // the canonical BASE_QUESTIONS if absent/tampered.
  const questions = Array.isArray(b.questions)
    ? b.questions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    : [];
  return { cycleId, answers, freeNotes, source, sessionId, durableItems, questions };
}

/**
 * Fold an incoming brief into the one already on the cycle.
 *
 * ── THE SUBMISSION MAY ALREADY CONTAIN WHAT WE HOLD ──────────────────────────────────
 *
 * This used to be an unconditional append, which was right while the composer was always empty
 * on arrival: everything that came back was, by construction, new. It is no longer true of
 * either surface. The workspace composer is now seeded with the saved brief (IntakeCapture),
 * and the guided stepper has ALWAYS seeded its free-notes field from `intake.freeNotes` — so
 * that path has been silently doubling the brief on every re-save since it shipped, whether or
 * not anyone opened the workspace.
 *
 * So a resubmission that OPENS WITH everything we already hold is not an addition to the brief;
 * it IS the brief, carrying whatever was typed onto the end of it. Storing it as `cur + add`
 * would write the month down twice and hand the extractor a doubled September — the same
 * launch counted twice, the same dates parsed twice.
 *
 * The prefix test is the whole rule, and it is deliberately narrow. Text that does not begin
 * with what we hold is a genuine addition and still appends, which keeps the "Add to brief"
 * flow (the composer clears itself after a save) working exactly as it did.
 *
 * KNOWN GAP, stated rather than papered over: an in-place edit of already-saved words — the
 * client changing a date in the middle of the brief — no longer starts with `curNotes`, so it
 * appends and the old sentence survives beside the new one. Expressing that needs a replace
 * mode this route does not have, and inventing one here would change what every existing
 * caller's save means. Left for its own change.
 */
function mergeFreeNotes(curNotes: string, addNotes: string): string {
  if (!addNotes) return curNotes;
  if (!curNotes) return addNotes;
  if (addNotes.startsWith(curNotes)) return addNotes;   // the seeded brief came back — take it whole
  return `${curNotes}\n\n${addNotes}`;
}

/**
 * Merge new answers/freeNotes into the existing intake_json (never clobber).
 *
 * ── IT SPREADS `cur` FIRST, AND THAT IS NOT TIDYING ──────────────────────────────────
 *
 * This used to rebuild the object field by field from the five keys `IntakeJson` declares,
 * which silently DELETED every key the type does not name. There is one: `draftApplications`,
 * the reshape receipts — `draft-apply.ts` writes them as `{ ...intake, draftApplications }`
 * (persistReceipt) and `loadReceipts` is the draft surface's history of what its own words did
 * to the month.
 *
 * So every brief save wiped the receipts of every voice reshape before it. That was survivable
 * while the wizard was the only writer here and the voice path was the only reader. It is not
 * survivable now: on a draft month a save goes on to append its own receipt, so the client
 * would end each save holding exactly one — the last thing they said, with everything they had
 * said before it gone from the panel that exists to show them.
 *
 * Spreading `cur` keeps whatever the row holds and overwrites only what this function owns.
 */
function mergeIntake(cur: IntakeJson | null, answers: Record<string, string>, freeNotes: string, source: 'web' | 'voice'): IntakeJson {
  const curAnswers = cur?.planContent?.answers ?? {};
  const curNotes = (cur?.planContent?.freeNotes ?? '').trim();
  const addNotes = freeNotes.trim();
  const mergedNotes = mergeFreeNotes(curNotes, addNotes);
  return {
    ...(cur ?? {}),
    planContent:     { answers: { ...curAnswers, ...answers }, freeNotes: mergedNotes },
    businessContext: cur?.businessContext ?? [],
    otherChannel:    cur?.otherChannel ?? {},
    source:          source === 'voice' ? 'voice' : 'manual',
    capturedAt:      new Date().toISOString(),
  };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const { clientId } = session;

  if (!allowRequest(`intake:${clientId}:${session.cycleId}`)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }); }
  const { cycleId, answers, freeNotes, source, sessionId, durableItems, questions } = parseBody(body);
  if (!cycleId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Ownership: the cycle must belong to the session's client (standard check).
  const [cycle] = await db
    .select({ status: contentCycles.status, intakeJson: contentCycles.intakeJson, cycleMonth: contentCycles.cycleMonth })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, clientId)))
    .limit(1);
  if (!cycle) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // durableItems ALWAYS persist (cycle-independent), regardless of cutoff.
  let durableSaved = 0;
  for (const item of durableItems) {
    try { await saveDurableInput({ clientId, type: item.type, content: item.text, source }); durableSaved++; }
    catch { /* best-effort; a single bad item never fails the whole submit */ }
  }

  const hasIntakeContent = Object.values(answers).some((v) => v.trim().length > 0) || freeNotes.trim().length > 0;
  const prePlanning = PRE_PLANNING_STATUSES.has(cycle.status);

  // ── THE CLASSIFIER ──────────────────────────────────────────────────────────
  if (prePlanning) {
    let beatsReady = false;
    let extracted: ExtractedSummary | undefined;
    // The reshape's results, when this cycle had a draft to reshape. Absent on a month with no
    // draft, which is the unassembled first-brief case and keeps its original behaviour exactly.
    let draftApplied = false;
    let beats: DraftBeatView[] | undefined;
    let application: DraftApplication | undefined;
    let draftApplyError: string | undefined;
    if (hasIntakeContent) {
      /**
       * THE MONTH AS THE CLIENT LEFT IT, read before anything in this request changes it.
       *
       * Two consumers, deliberately one read: it is the extractor's CURRENT PLAN section (so
       * "move the launch post" resolves against real dates), and it is the test for whether
       * this cycle has a draft to reshape at all. Reading it after the reshape would give the
       * extractor a month that already contains the answer to the brief it is extracting.
       */
      const beatsBefore = await loadCurrentPlan(clientId, cycleId);
      const next = mergeIntake(cycle.intakeJson as IntakeJson | null, answers, freeNotes, source);
      // Prompt 2: distribute the running freeform brief across EMPTY base-question answer slots
      // (non-fatal) BEFORE persisting, so the generator + admin IntakePanel see populated answers.
      // The free text is already in freeNotes, so a distribution failure loses nothing.
      const qs = questions.length ? questions : [...BASE_QUESTIONS];
      await distributeIntoEmptyAnswers(next, qs, clientId);
      await db.update(contentCycles).set({ intakeJson: next as unknown, updatedAt: new Date() }).where(eq(contentCycles.id, cycleId));

      /**
       * ── THE LEDGER ROW, immediately after the write it records ────────────────────────
       *
       * Placed HERE and not at the end of the branch, because this is the line after which the
       * brief is on the cycle. Everything below — the brief clear, the extraction — is
       * explicitly allowed to fail without losing the intake, so a row written after them would
       * be a row that fails to appear for saves that unambiguously happened.
       *
       * A throw from the update above skips this entirely, which is the "no row on a failed
       * save" half of the contract; the catch below is the other half, and it deliberately
       * swallows. The client's brief IS saved by this point. Returning 500 because the ledger
       * insert failed would tell them it had not, and what they do about that is retype the
       * month into a merge that would then hold it twice — the exact fault this whole change
       * exists to close. The ledger is an observation of the write, never a veto over it. Same
       * posture as durableItems above, for the same reason.
       *
       * No postId: this is about the month, not about any row in it. plan_activity.post_id is
       * nullable and cycle_id carries the meaning here.
       */
      try {
        await recordActivity(db, {
          clientId,
          cycleId,
          action:  'brief_saved',
          actor:   USER_ACTOR,                 // origin 'user', actor 'client' — reached via a magic-link session
          payload: {
            source,                                                     // 'web' | 'voice'
            answersSaved:   Object.keys(next.planContent.answers).length,
            freeNotesChars: next.planContent.freeNotes.length,
          },
        });
      } catch { /* observation only — never fails a save that already landed */ }

      // Intake changed → clear the extract-once brief (Build 1 helper), then FIX 2: extract + persist
      // inline so beats appear immediately. Intake is already saved; extraction failure is non-fatal.
      await clearStructuredBriefIfPrePlanning(db, cycleId);
      const brief = await extractAndPersistBrief(cycleId, cycle.cycleMonth, next, clientId, asPlanState(beatsBefore));
      beatsReady = brief !== null;
      if (brief) extracted = summariseBrief(brief);

      /**
       * ── THE BRIEF RESHAPES THE MONTH ──────────────────────────────────────────────────
       *
       * Only when there is already a draft here. A month with no beats is the first-brief case:
       * nothing to reshape, and the cutoff's planning run is what builds it — that path is
       * untouched, which is why this is gated on `beatsBefore` rather than on the flag or the
       * status.
       *
       * `applyBriefToDraft`, NOT assembly. Assembly is a day-1 act that replaces the whole month:
       * `retireDraftPosts` is scoped to the cycle with no exemption, so it would take the beats
       * the client moved and the beats they added along with everything else. The transform path
       * is additive and reads `beat_meta.clientTouched` as an absolute protection, which is the
       * only way a brief can change a month the client has already worked on.
       *
       * NON-FATAL, on the same terms as the extraction above it: the intake is saved by this
       * point and the ledger row is written. A reshape that fails leaves the client's words
       * recorded and the month as it was — never a lost save. What it must not do is fail
       * SILENTLY, so the error rides back on the response and the surface says so.
       *
       * ── AND IT IS HANDED THE BRIEF THE LINE ABOVE JUST EXTRACTED ─────────────────────
       *
       * Two model passes read this same sentence. `extractStructuredBrief` is the careful one
       * — it saw the whole brief at once, resolved "the week before" into a real window and
       * dated every beat — and its answer went to a column the reshape never read, while
       * `classifyIntake` re-derived a date per segment and placed the month from that. They
       * disagreed by a week on ivy-t's Hannah launch and the worse answer won, because it was
       * the only one this path could see.
       *
       * `brief` is whatever came back above, including NULL: the extraction runs inside a 25s
       * race and returns null on timeout or on output the gate rejects. Null degrades to
       * exactly the previous behaviour — `briefArcDatesFor` answers `{}` and every date comes
       * from the classifier as before.
       */
      const instruction = briefInstruction(answers, freeNotes);
      if (beatsBefore.length > 0 && instruction) {
        try {
          const applied = await applyBriefToDraft({
            clientId, cycleId, text: instruction, model: getModelClient(), source, brief,
          });
          if (applied.ok) {
            draftApplied = true;
            beats = applied.beats;
            application = applied.application;
          } else {
            draftApplyError = applied.message;
          }
        } catch {
          draftApplyError = 'We saved your brief, but couldn’t update the month just now.';
        }
      }
    }
    return NextResponse.json({
      mode: 'brief_updated', prePlanning: true, briefCleared: hasIntakeContent, beatsReady, extracted, durableSaved,
      // Present only when a draft was reshaped. `beats` is the authoritative post-apply month, so
      // the surface renders what happened rather than refetching to find out.
      draftApplied, beats, application, draftApplyError,
    });
  }

  // POST-cutoff: do NOT touch intake_json — route the info to proposals via the agent loop.
  if (!hasIntakeContent) {
    return NextResponse.json({ mode: 'noop', prePlanning: false, durableSaved, message: 'This month has generated — noted your durable context for the future.' });
  }
  const turn = await runPlanAgentTurn({ clientId, cycleId, instruction: briefInstruction(answers, freeNotes), source, sessionId });
  return NextResponse.json({ mode: 'proposed', prePlanning: false, durableSaved, ...turn });
}
