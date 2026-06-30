import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client.js';

// Arbitrary fixed key for the session-level advisory lock that serialises
// concurrent migration runs (e.g. rolling deploys where the new container
// boots and migrates while the old one is still draining).
// MUST remain identical across all instances — changing it defeats the lock.
// No existing advisory-lock-key convention was found in this codebase.
const MIGRATION_LOCK_KEY = 4_672_831;

// Known boundary: if a container is hard-killed (SIGKILL / OOM) mid-migration
// Postgres automatically releases the advisory lock on session death, so the
// next boot can proceed. However the underlying migration may be half-applied.
// That is handled by writing atomic/transactional migrations, not by this runner.

let lockAcquired = false;

try {
  await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
  lockAcquired = true;

  await migrate(db, { migrationsFolder: './migrations' });
  console.log('Migration complete');
} catch (err) {
  console.error('Migration failed:', err);
  process.exitCode = 1;
} finally {
  if (lockAcquired) {
    await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(() => {});
  }
  await sql.end().catch(() => {});
}

if (process.exitCode === 1) process.exit(1);
process.exit(0);
