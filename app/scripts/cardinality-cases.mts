/**
 * cardinality-cases.mts — the named cases, against the real month, WITHOUT writing to it.
 *
 *   pnpm --filter @sprigly/app exec vite-node --config vitest.config.ts \
 *     scripts/cardinality-cases.mts -- --cycle=<uuid>
 *
 * Real classifier (one Bedrock call per case), real beats read from the cycle, real
 * `applyCorrection`. What it does NOT do is execute the ops — so every case runs against the
 * same month state and none of them move a post. That is what makes the set comparable: a
 * live sequence changes the board under itself, and then "all 3 moved" and "1 of 3 moved"
 * are answers to different questions.
 *
 * The end-to-end client experience is a separate harness (draft-cardinality.uat.ts), because
 * the failing sequence needs a conversation and therefore needs the writes.
 *
 * READ-ONLY on the plan. It does spend on Bedrock, and logs no ledger row (no auditor) —
 * this is a probe, not a product path.
 */
import { db, contentCyclePosts } from '@sprigly/db';
import { and, eq, isNull } from 'drizzle-orm';
import { classifyIntake, applyIntent, requestedCount, type TransformBeat } from '@sprigly/engine';
import { getModelClient } from '../src/lib/agent/model';

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const CYCLE = arg('cycle') ?? '5ea00045-155d-497b-ac2e-a27eae36f235';
const PLAN_MONTH = arg('month') ?? '2026-11';
const TODAY = arg('today') ?? '2026-08-12';

const rows = await db.select({
  id: contentCyclePosts.id, scheduledDate: contentCyclePosts.scheduledDate,
  format: contentCyclePosts.format, pillar: contentCyclePosts.pillar,
  position: contentCyclePosts.position, beatMeta: contentCyclePosts.beatMeta,
  sourceMeta: contentCyclePosts.sourceMeta,
}).from(contentCyclePosts).where(and(
  eq(contentCyclePosts.cycleId, CYCLE),
  eq(contentCyclePosts.status, 'draft'),
  isNull(contentCyclePosts.deletedAt),
));

const beats: TransformBeat[] = rows.map((r) => ({
  id: r.id, date: r.scheduledDate, format: r.format, pillar: r.pillar ?? '',
  title: typeof r.sourceMeta?.['title'] === 'string' ? (r.sourceMeta['title'] as string) : (r.pillar ?? ''),
  position: r.position, beatMeta: r.beatMeta,
})).sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position);

const onDate = (d: string) => beats.filter((b) => b.date === d);
const byId = new Map(beats.map((b) => [b.id, b]));

console.log(`\ncycle ${CYCLE} — ${beats.length} draft beats`);
for (const d of ['2026-11-07', '2026-11-12', '2026-11-15', '2026-11-19']) {
  console.log(`  ${d}: ${onDate(d).length} beat(s)${onDate(d).length ? ` — ${onDate(d).map((b) => b.title).join(' / ')}` : ''}`);
}

const model = getModelClient();

const CASES: string[] = [
  'move a post from the 12th to the week before',
  'move one of the posts on the 12th to the 10th',
  'move the posts from the 12th to the 10th',
  'move everything on the 15th to the 14th',
  'move 2 posts from the 7th to the 6th',
  'move the 12th to the 10th',
  'move the 19th to the 20th',
  'move a post from the 19th to the 20th',
];

for (const text of CASES) {
  const r = await classifyIntake({ text, planMonth: PLAN_MONTH, model });
  console.log(`\n"${text}"`);
  console.log(`   count read from the sentence: ${requestedCount(text) ?? 'null (all)'}`);
  if (r.scope !== 'month_scoped') { console.log(`   → ${r.scope}/${'reason' in r ? r.reason : ''} — never reaches the transform`); continue; }
  if (r.intent.kind !== 'correction') { console.log(`   → kind=${r.intent.kind}, not a correction`); continue; }

  const res = applyIntent(r.intent, beats, PLAN_MONTH, TODAY);
  const moved = res.ops.flatMap((o) => ('id' in o ? [byId.get(o.id)!] : []));
  console.log(`   → ${moved.length} beat(s) would move: ${moved.map((b) => `“${b.title}”`).join(', ') || '(none)'}`);
  console.log(`   receipt: ${res.note ?? '(no note)'}`);
}

process.exit(0);
