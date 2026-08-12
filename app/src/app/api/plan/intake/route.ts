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
import { extractStructuredBrief, distributeBriefAnswers, loadDurableInputs, BASE_QUESTIONS, type IntakeJson, type StructuredBrief } from '@sprigly/engine';
import type { ExtractedSummary } from '@/lib/types';
// The save path and the LATER page loads describe a brief with the same sentences — see
// brief-summary.ts for why that is one definition and not two.
import { summariseBrief } from '@/lib/brief-summary';
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
 * FIX 2 — extract the structured brief inline and persist it, so beats appear immediately after
 * Send. The intake_json is already SAVED before this runs, so a failed/slow/malformed extraction
 * never loses the brief: on any error we return false and leave structured_brief null (the
 * extract-gate's fail-loud validation still applies — a malformed brief is never persisted), and
 * the lazy planning-path re-extracts later. Returns whether beats are now ready.
 */
async function extractAndPersistBrief(cycleId: string, cycleMonth: string, intake: IntakeJson, clientId: string): Promise<StructuredBrief | null> {
  try {
    const planMonth = nextMonth(cycleMonth);
    const durableContext = await loadDurableContext(clientId, planMonth);
    const brief = await Promise.race([
      extractStructuredBrief({
        planContent: intake.planContent, planMonth, model: getModelClient(), clientId, durableContext,
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

/** Merge new answers/freeNotes into the existing intake_json (never clobber). */
function mergeIntake(cur: IntakeJson | null, answers: Record<string, string>, freeNotes: string, source: 'web' | 'voice'): IntakeJson {
  const curAnswers = cur?.planContent?.answers ?? {};
  const curNotes = (cur?.planContent?.freeNotes ?? '').trim();
  const addNotes = freeNotes.trim();
  const mergedNotes = mergeFreeNotes(curNotes, addNotes);
  return {
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
    if (hasIntakeContent) {
      const next = mergeIntake(cycle.intakeJson as IntakeJson | null, answers, freeNotes, source);
      // Prompt 2: distribute the running freeform brief across EMPTY base-question answer slots
      // (non-fatal) BEFORE persisting, so the generator + admin IntakePanel see populated answers.
      // The free text is already in freeNotes, so a distribution failure loses nothing.
      const qs = questions.length ? questions : [...BASE_QUESTIONS];
      await distributeIntoEmptyAnswers(next, qs, clientId);
      await db.update(contentCycles).set({ intakeJson: next as unknown, updatedAt: new Date() }).where(eq(contentCycles.id, cycleId));
      // Intake changed → clear the extract-once brief (Build 1 helper), then FIX 2: extract + persist
      // inline so beats appear immediately. Intake is already saved; extraction failure is non-fatal.
      await clearStructuredBriefIfPrePlanning(db, cycleId);
      const brief = await extractAndPersistBrief(cycleId, cycle.cycleMonth, next, clientId);
      beatsReady = brief !== null;
      if (brief) extracted = summariseBrief(brief);
    }
    return NextResponse.json({ mode: 'brief_updated', prePlanning: true, briefCleared: hasIntakeContent, beatsReady, extracted, durableSaved });
  }

  // POST-cutoff: do NOT touch intake_json — route the info to proposals via the agent loop.
  if (!hasIntakeContent) {
    return NextResponse.json({ mode: 'noop', prePlanning: false, durableSaved, message: 'This month has generated — noted your durable context for the future.' });
  }
  const lines: string[] = [];
  for (const [q, a] of Object.entries(answers)) if (a.trim()) lines.push(`${q} — ${a.trim()}`);
  if (freeNotes.trim()) lines.push(freeNotes.trim());
  const instruction = lines.join('\n');
  const turn = await runPlanAgentTurn({ clientId, cycleId, instruction, source, sessionId });
  return NextResponse.json({ mode: 'proposed', prePlanning: false, durableSaved, ...turn });
}
