// One-off: reset a content cycle back to 'scheduled' for re-testing.
// Usage: pnpm --filter @sprigly/worker reset-cycle <clientId> <cycleMonth>
//
// clientId is REQUIRED and has no fallback. It used to default to a hardcoded production
// client id, so a bare `reset-cycle` with no arguments silently rewrote a real client's
// cycle status. A destructive tool must never guess who it is acting on.
import { db, contentCycles } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';

const clientId = process.argv[2];
if (!clientId) {
  console.error('reset-cycle: missing required argument <clientId>.');
  console.error('usage: pnpm --filter @sprigly/worker reset-cycle <clientId> <cycleMonth>');
  process.exit(1);
}

const cycleMonth = process.argv[3] ?? '2026-05';

const rows = await db
  .update(contentCycles)
  .set({ status: 'scheduled', requestSentAt: null })
  .where(and(eq(contentCycles.clientId, clientId), eq(contentCycles.cycleMonth, cycleMonth)))
  .returning({ id: contentCycles.id, status: contentCycles.status });

console.log(JSON.stringify(rows));
