/**
 * connection-health.ts — track OAuth connection health so a revoked/expired refresh
 * token stops the retry storm instead of failing every 60s forever.
 *
 * On invalid_grant a poller calls markConnectionError → status flips to 'error'.
 * Every poller selects `where(status = 'active')`, so an 'error' row drops out of
 * all polling until a successful reconnect (storeTokens) flips it back to 'active'.
 */
import { and, eq, ne } from 'drizzle-orm';
import { db as _db, oauthConnections } from '@sprigly/db';
import type { OAuthProvider } from './types.js';

type Db = typeof _db;

/** True when an error is Google's invalid_grant (revoked/expired refresh token). */
export function isInvalidGrant(err: unknown): boolean {
  const msg = typeof err === 'string' ? err : (err as { message?: unknown } | null)?.message;
  if (/invalid_grant/i.test(String(msg ?? ''))) return true;
  const data = (err as { response?: { data?: { error?: unknown } } } | null)?.response?.data;
  return data?.error === 'invalid_grant';
}

/** Flip a connection to 'error' and record the auth failure. Returns true ONLY on
 *  the transition (status was not already 'error'), so callers log exactly once and
 *  don't re-log every poll cycle. */
export async function markConnectionError(
  db: Db,
  clientId: string,
  provider: OAuthProvider,
  message: string,
): Promise<boolean> {
  const rows = await db
    .update(oauthConnections)
    .set({ status: 'error', lastError: message.slice(0, 500), lastErrorAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(oauthConnections.clientId, clientId),
      eq(oauthConnections.provider, provider),
      ne(oauthConnections.status, 'error'),
    ))
    .returning({ id: oauthConnections.id });
  return rows.length > 0;
}

/** Record a successful token use (drives the panel's last_ok_at). Best-effort. */
export async function markConnectionOk(
  db: Db,
  clientId: string,
  provider: OAuthProvider,
): Promise<void> {
  await db
    .update(oauthConnections)
    .set({ lastOkAt: new Date() })
    .where(and(eq(oauthConnections.clientId, clientId), eq(oauthConnections.provider, provider)));
}
