/**
 * query-prefix-size.mts — how big is the query answerer's invariant prefix, really?
 *
 * The question this answers is the only one that decides whether a cache_point on this path
 * does anything at all: Haiku 4.5's minimum cacheable prefix is 4,096 tokens, and a prefix
 * below it is not cached, raises no error, and looks identical to one that worked.
 *
 * Read-only, no model call, no writes. Prints the composition so the split can be argued from
 * measurements rather than from a guess about which half is the bulk.
 */
import { buildPlanContext } from '../src/lib/agent/plan-context';
import { bucketCycleState } from '../src/lib/agent/cycle-state';
import { QUERY_SYSTEM_PROMPT } from '../src/lib/agent/query';
import { db, contentCycles } from '@sprigly/db';
import { eq } from 'drizzle-orm';

const arg = (k: string) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const CYCLE = arg('cycle') ?? '0b9677e5-d06d-4de5-9207-527cd837333a';
const TODAY = arg('today') ?? '2026-08-05';

const [row] = await db
  .select({ clientId: contentCycles.clientId })
  .from(contentCycles).where(eq(contentCycles.id, CYCLE)).limit(1);
if (!row) throw new Error(`no cycle ${CYCLE}`);

const ctx = await buildPlanContext(row.clientId, CYCLE, TODAY);
const scoped = ctx.months.length
  ? ctx.posts.filter((p) => ctx.months.includes(p.date.slice(0, 7)))
  : ctx.posts;
const planState = bucketCycleState(scoped, new Date(`${TODAY}T00:00:00`), ctx.months, ctx.beats).summary;

/** Chars → tokens, roughly. Only used to SIZE the decision; the live cacheWrite is the truth. */
const est = (s: string) => Math.round(s.length / 3.6);

const rows = [
  ['system prompt (QUERY_SYSTEM_PROMPT)', QUERY_SYSTEM_PROMPT],
  ['PLAN STATE header + facts', planState.split('Posts (by date):')[0] ?? ''],
  ['PLAN STATE post rows', `Posts (by date):${planState.split('Posts (by date):')[1] ?? ''}`],
] as const;

console.log(`\n${'='.repeat(72)}`);
for (const [label, text] of rows) {
  console.log(`${label.padEnd(40)} ${String(text.length).padStart(7)} chars  ~${String(est(text)).padStart(5)} tok`);
}
const prefix = `${QUERY_SYSTEM_PROMPT}\n\nPLAN STATE:\n${planState}`;
console.log('-'.repeat(72));
console.log(`${'CACHEABLE PREFIX (system + plan state)'.padEnd(40)} ${String(prefix.length).padStart(7)} chars  ~${String(est(prefix)).padStart(5)} tok`);
console.log(`\nHaiku 4.5 minimum cacheable prefix: 4096 tokens.`);
console.log(est(prefix) >= 4096
  ? `  → estimated ABOVE the minimum. A cache_point here should take effect.`
  : `  → estimated BELOW the minimum. A cache_point here would silently do nothing.`);
console.log(`${'='.repeat(72)}\n`);

process.exit(0);
