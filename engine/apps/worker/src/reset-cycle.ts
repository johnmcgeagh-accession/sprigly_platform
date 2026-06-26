// One-off: reset a content cycle back to 'scheduled' for re-testing.
// Usage: pnpm --filter @sprigly/worker reset-cycle <clientId> <cycleMonth>
import { db, contentCycles } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';

const clientId   = process.argv[2] ?? 'c79cf1c5-b51d-4a9b-aedc-48577df43e8f';
const cycleMonth = process.argv[3] ?? '2026-05';

const rows = await db
  .update(contentCycles)
  .set({ status: 'scheduled', requestSentAt: null })
  .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.cycleMonth, cycleMonth)))
  .returning({ id: contentCycles.id, status: contentCycles.status });

console.log(JSON.stringify(rows));
