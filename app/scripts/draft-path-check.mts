/**
 * draft-path-check.mts — ask the DRAFT SURFACE'S OWN PATH a question, and print what it answers.
 *
 *   pnpm --filter @sprigly/app draft-path-check
 *   pnpm --filter @sprigly/app draft-path-check --cycle=<uuid> --today=2026-08-26
 *   pnpm --filter @sprigly/app draft-path-check "what's on next week?"
 *
 * ── Why this exists beside query-eval ────────────────────────────────────────────────
 *
 * query-eval calls `answerQuery` DIRECTLY. That is the right shape for measuring the answerer,
 * and it is exactly why it could not see the defect that mattered most: on a draft month the
 * client never reaches `answerQuery` at all. `PlanRoot` renders `DraftSurface`, whose only send
 * path is `POST /api/plan/draft/apply` → `applyIntakeToDraft`, and `answerQuery` is reachable
 * only from `runPlanAgentTurn`. The harness answered "what's on next week?" exactly while the
 * app returned a 27-line month dump, and both were behaving as written.
 *
 * So this harness enters at the OTHER end: the same function the route calls, with the same
 * arguments, through `classifyIntake` and its question gate. Between the two you can see
 * whether the surfaces agree — which is the check that was missing.
 *
 * ── READ-ONLY, and specifically how ──────────────────────────────────────────────────
 *
 * `suppressReceipt: true`. The question branch's only write is `persistReceipt`, which appends
 * to `content_cycles.intake_json.draftApplications`; suppressing it makes this a pure read of
 * the plan. Nothing is approved, generated, or written to the month.
 *
 * It DOES write the audit_log rows a real question turn writes, because it makes the real calls
 * — one Titan embed and one Haiku answer. That is spend, honestly recorded, on the ledger the
 * product reads. Operator-invoked only; it lives in scripts/, so Vitest never collects it.
 */
import { applyIntakeToDraft } from '../src/lib/draft-apply';
import { parsePlanQuestion } from '@sprigly/engine';
import { getModelClient } from '../src/lib/agent/model';
import { db, contentCycles } from '@sprigly/db';
import { eq } from 'drizzle-orm';

for (const level of ['info', 'warn', 'debug'] as const) {
  console[level] = (...p: unknown[]) => process.stderr.write(p.map(String).join(' ') + '\n');
}

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

const CYCLE = arg('cycle') ?? '0b9677e5-d06d-4de5-9207-527cd837333a';
const TODAY = arg('today') ?? '2026-08-05';

/** The questions the app was observed answering with a month dump, plus the boundary one. */
const DEFAULT_QUESTIONS = [
  "what's in September?",
  "what's on next week?",
  'which post in September is just an image?',
  'the 18th feels busy, what do you think?',
  'how many empty dates are there in September?',
];
const positional = args.filter((a) => !a.startsWith('--'));
const QUESTIONS = positional.length ? positional : DEFAULT_QUESTIONS;

const [row] = await db
  .select({ clientId: contentCycles.clientId })
  .from(contentCycles)
  .where(eq(contentCycles.id, CYCLE))
  .limit(1);
if (!row) { console.error(`draft-path-check: no cycle ${CYCLE}`); process.exit(1); }

console.log(`${'─'.repeat(96)}`);
console.log(`THE DRAFT SURFACE'S OWN PATH — applyIntakeToDraft, receipt suppressed`);
console.log(`cycle ${CYCLE} · client ${row.clientId} · today ${TODAY}`);
console.log(`${'─'.repeat(96)}`);

for (const text of QUESTIONS) {
  // Printed because it decides everything: the gate claims the question INSIDE classifyIntake,
  // before its model call. A question it does not claim never reaches the question branch — it
  // falls through to the classifier and is filed as an idea.
  const gate = parsePlanQuestion(text);
  console.log(`\n\n══ ${JSON.stringify(text)}`);
  console.log(`   parsePlanQuestion → ${gate ?? 'null (falls through to classifyIntake)'}`);

  const started = process.hrtime.bigint();
  const res = await applyIntakeToDraft({
    clientId: row.clientId, cycleId: CYCLE, text, model: getModelClient(),
    today: TODAY, suppressReceipt: true,
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  if (!res.ok) { console.log(`   FAILED ${res.error}: ${res.message}`); continue; }
  const a = res.application;
  console.log(`   scope=${a.scope}${a.reason ? ` reason=${a.reason}` : ''} · ${a.lines.length} line(s) · changed ${a.changedIds.length} · ${Math.round(ms)}ms`);
  console.log('');
  for (const l of a.lines) console.log(`     ${l}`);
  if (a.note) console.log(`     NOTE: ${a.note}`);
}

console.log(`\n\nNothing was written to the month — receipts suppressed, no beats touched.`);
process.exit(0);
