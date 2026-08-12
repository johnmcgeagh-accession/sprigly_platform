import { db, contentCycles } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { extractStructuredBrief } from '@sprigly/engine';
import { getModelClient } from '../src/lib/agent/model';

const CYCLE = '5ea00045-155d-497b-ac2e-a27eae36f235';
const [row] = await db.select({ j: contentCycles.intakeJson, m: contentCycles.cycleMonth })
  .from(contentCycles).where(eq(contentCycles.id, CYCLE));
const intake = row!.j as { planContent: unknown };
const free = (intake.planContent as { freeNotes?: string }).freeNotes ?? '';
console.log('accumulated freeNotes length:', free.length);
for (const p of ['X', 'Y', 'Maggie']) {
  const hit = new RegExp(`\\b${p}\\b`).test(free);
  console.log(`  intake mentions ${p}: ${hit}`);
}
// No auditor, no persistence — a probe, not a product path.
const brief = await extractStructuredBrief({
  planContent: intake.planContent as never, planMonth: '2026-11', model: getModelClient(), clientId: 'probe',
});
const sched = (brief?.schedule ?? []) as Array<Record<string, unknown>>;
console.log(`\nre-extraction produced ${sched.length} schedule entries:`);
for (const e of sched) console.log(`  type=${e['type']} product=${e['product']} date=${e['date']} range=${JSON.stringify(e['dateRange'])}`);
process.exit(0);
