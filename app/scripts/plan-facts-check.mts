/**
 * plan-facts-check.mts — DEMONSTRATE that the answerer is reading the numbers, not counting them.
 *
 *   pnpm --filter @sprigly/app plan-facts-check
 *   pnpm --filter @sprigly/app plan-facts-check --cycle=<uuid>
 *
 * Runs under vite-node for the same reason `cache-check.mts` does: the app package is CommonJS
 * while @sprigly/model-client is ESM-only, so only vite's resolution lets this import the REAL
 * context builder and the REAL answerer. Importing the real ones is the whole point — a harness
 * that rebuilt the plan state itself could only prove things about its own copy.
 *
 * Why a live call rather than a unit test: the unit tests pin the arithmetic and the string, and
 * they cannot pin the only thing actually in question — whether a small model, handed a stated
 * figure and a list, quotes the figure or counts the list. That is a fact about the model's
 * behaviour on this exact prompt, and the only honest way to establish it is to ask.
 *
 * READ-ONLY. No audit logger is passed, so no ledger rows are written; nothing else here writes
 * at all. It SPENDS a few Haiku calls and one Titan embed per question — pennies. Operator-invoked
 * only. It lives in scripts/, so Vitest never collects it and CI never spends.
 */
import { buildPlanContext } from '../src/lib/agent/plan-context';
import { bucketCycleState } from '../src/lib/agent/cycle-state';
import { answerQuery } from '../src/lib/agent/query';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { createEmbeddingClientFromEnv } from '@sprigly/embedding-client';
import { db, contentCycles } from '@sprigly/db';
import { eq } from 'drizzle-orm';

const arg = (k: string) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);

const CYCLE = arg('cycle') ?? '0b9677e5-d06d-4de5-9207-527cd837333a';
const TODAY = arg('today') ?? '2026-08-05';

const QUESTIONS = [
  'what’s in September?',
  'how many empty dates are there in September?',
  'what’s the balance of the pillars?',
  'what’s the format mix in September?',
];

/**
 * `--repeat=N` asks each question N times.
 *
 * The defect was never "the answer is wrong" — it was "the answer MOVES": 27, then 15, then 26,
 * then 30, then 28, for a month that did not change between any two turns. One correct answer is
 * therefore not evidence of a fix, and the flag exists so the thing that was actually broken is
 * the thing that gets measured.
 */
const REPEAT = Math.max(1, Math.min(10, Number(arg('repeat') ?? 1) || 1));

const rule = (s: string) => console.log(`\n${'━'.repeat(78)}\n${s}\n${'━'.repeat(78)}`);

const [row] = await db
  .select({ clientId: contentCycles.clientId, month: contentCycles.cycleMonth })
  .from(contentCycles)
  .where(eq(contentCycles.id, CYCLE))
  .limit(1);
if (!row) throw new Error(`no cycle ${CYCLE}`);

const ctx = await buildPlanContext(row.clientId, CYCLE, TODAY);

rule(`CONTEXT — client ${row.clientId}, cycle ${CYCLE}, today ${TODAY}`);
console.log(`resolution set : ${ctx.posts.length} posts across ${ctx.cycles.length} cycles`);
console.log(`digest months  : ${ctx.months.join(', ')}`);
console.log(`in scope       : ${ctx.posts.filter((p) => ctx.months.includes(p.date.slice(0, 7))).length} posts`);

// The SAME scoping the answerer applies (query.ts → postsInScope), so what is printed below is
// byte-identical to what the model is sent.
const scoped = ctx.months.length
  ? ctx.posts.filter((p) => ctx.months.includes(p.date.slice(0, 7)))
  : ctx.posts;

rule('PLAN STATE — verbatim, exactly as the model receives it');
console.log(bucketCycleState(scoped, new Date(`${TODAY}T00:00:00`), ctx.months, ctx.beats).summary);

const model = createModelClientFromEnv();
const embeddingClient = createEmbeddingClientFromEnv();

for (const question of QUESTIONS) {
  rule(`Q: ${question}${REPEAT > 1 ? `  (asked ${REPEAT}×)` : ''}`);
  for (let i = 0; i < REPEAT; i++) {
    const res = await answerQuery(
      { clientId: row.clientId, cycleId: CYCLE, question, today: new Date(`${TODAY}T00:00:00`), context: ctx },
      { model, embeddingClient },   // no `audit` — this writes nothing
    );
    if (REPEAT > 1) console.log(`\n── ask ${i + 1} ──`);
    console.log(res.text);
    console.log(`[outcome: ${res.outcome}]`);
  }
}

process.exit(0);
