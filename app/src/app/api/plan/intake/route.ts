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
import type { IntakeJson } from '@sprigly/engine';
import { getSession } from '@/lib/auth';
import { allowRequest } from '@/lib/rate-limit';
import { saveDurableInput } from '@/lib/agent/notes';
import { runPlanAgentTurn } from '@/lib/agent/turn';

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
  return { cycleId, answers, freeNotes, source, sessionId, durableItems };
}

/** Merge new answers/freeNotes into the existing intake_json (never clobber). */
function mergeIntake(cur: IntakeJson | null, answers: Record<string, string>, freeNotes: string, source: 'web' | 'voice'): IntakeJson {
  const curAnswers = cur?.planContent?.answers ?? {};
  const curNotes = (cur?.planContent?.freeNotes ?? '').trim();
  const addNotes = freeNotes.trim();
  const mergedNotes = curNotes && addNotes ? `${curNotes}\n\n${addNotes}` : (addNotes || curNotes);
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
  const { cycleId, answers, freeNotes, source, sessionId, durableItems } = parseBody(body);
  if (!cycleId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Ownership: the cycle must belong to the session's client (standard check).
  const [cycle] = await db
    .select({ status: contentCycles.status, intakeJson: contentCycles.intakeJson })
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
    if (hasIntakeContent) {
      const next = mergeIntake(cycle.intakeJson as IntakeJson | null, answers, freeNotes, source);
      await db.update(contentCycles).set({ intakeJson: next as unknown, updatedAt: new Date() }).where(eq(contentCycles.id, cycleId));
      // Intake changed → clear the extract-once brief so it re-extracts (Build 1 helper).
      await clearStructuredBriefIfPrePlanning(db, cycleId);
    }
    return NextResponse.json({ mode: 'brief_updated', prePlanning: true, briefCleared: hasIntakeContent, durableSaved });
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
