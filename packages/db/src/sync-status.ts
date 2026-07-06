/**
 * sync-status.ts — the ONE honest writer of content_cycles.posts_sync_status.
 *
 * Why a dedicated helper on a FRESH connection: the flag's whole job is to tell
 * the truth about the posts-write. The most important moment to write it is right
 * after that write FAILED — and the failure that just aborted the merge transaction
 * may have poisoned the shared pool's session. So the failure stamp must not reuse
 * the shared `db`; it opens a short-lived connection, retries once, and — if it
 * still cannot persist — THROWS (escalates) rather than swallowing into a log line.
 * A silently stale 'synced' is exactly the bug this closes.
 *
 * Provenance (0061): on 'synced' we also record posts_synced_at + the writing run
 * id, so a 'synced' is attributable to one verified commit. On out_of_sync/unknown
 * we clear both — an unverified surface has no legitimate synced-provenance.
 */
import postgres from 'postgres';

export type PostsSyncStatus = 'synced' | 'out_of_sync' | 'unknown';

export interface SyncStampMeta {
  /** The write run this status is attributable to (required for 'synced'). */
  runId?:    string | null;
  /** When the write was verified to have landed (defaults to now() for 'synced'). */
  syncedAt?: Date | null;
}

/**
 * Persist posts_sync_status for a cycle on a FRESH, short-lived connection (never
 * the shared pool). Retries once; throws if both attempts fail — the caller decides
 * whether that throw is process-fatal (for the failure path it MUST be).
 */
export async function stampPostsSyncStatus(
  cycleId: string,
  status:  PostsSyncStatus,
  meta:    SyncStampMeta = {},
): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('stampPostsSyncStatus: DATABASE_URL is not set');

  const syncedAt = status === 'synced' ? (meta.syncedAt ?? new Date()) : null;
  const runId    = status === 'synced' ? (meta.runId ?? null)          : null;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    // A brand-new pool of exactly one connection, closed in finally — deliberately
    // NOT the shared `sql`, whose session may be aborted by the triggering failure.
    const conn = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
    try {
      await conn`
        update content_cycles
           set posts_sync_status   = ${status},
               posts_synced_at     = ${syncedAt},
               posts_synced_run_id = ${runId},
               updated_at          = now()
         where id = ${cycleId}
      `;
      return;
    } catch (err) {
      lastErr = err;
    } finally {
      await conn.end({ timeout: 5 }).catch(() => { /* connection teardown is best-effort */ });
    }
  }
  throw new Error(
    `stampPostsSyncStatus(${cycleId}, '${status}') failed after 2 attempts on fresh connections: ${String(lastErr)}`,
  );
}
