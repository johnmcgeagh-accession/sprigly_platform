/**
 * cardinality-probe.mts — what does the classifier make of the CARDINALITY cases?
 *
 *   ... scripts/cardinality-probe.mts -- [--runs=3]
 *
 * The question this answers, before any code is written: does the intent that reaches
 * `applyCorrection` carry the number the client said, in any form? One Bedrock call per run
 * per case. Read-only — no auditor, no writes.
 */
import { classifyIntake } from '@sprigly/engine';
import { getModelClient } from '../src/lib/agent/model';

const RUNS = Number(process.argv.find((a) => a.startsWith('--runs='))?.slice(7) ?? 1);
const model = getModelClient();

const CASES = [
  'move a post from the 17th to the week before',
  'move one of the posts on the 17th to the 10th',
  'move the posts from the 17th to the 10th',
  'move everything on the 17th to the 10th',
  'move 2 posts from the 10th to the 17th',
  'move the 17th to the 10th',
  'move the Hannah launch to the 20th',
];

for (const text of CASES) {
  const seen: string[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await classifyIntake({ text, planMonth: '2026-11', model });
    if (r.scope !== 'month_scoped') { seen.push(`evergreen/${r.reason}`); continue; }
    const it = r.intent as Record<string, unknown>;
    seen.push(`${it['kind']} correctionOf="${it['correctionOf'] ?? ''}" subject="${it['subject']}" date=${(it['dateRange'] as { start?: string } | null)?.start ?? '—'}`);
  }
  console.log(`\n"${text}"`);
  for (const s of new Set(seen)) console.log(`   ${seen.filter((x) => x === s).length}/${RUNS}  ${s}`);
}

process.exit(0);
