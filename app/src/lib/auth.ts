/**
 * auth.ts — password-less magic-link auth, DB-backed (app_magic_link_tokens).
 *
 * signLink/verifyLink is the contract; the implementation is a revocable DB token
 * (modelled on triage_digest_tokens) — re-resolved server-side on every request so
 * a leaked or expired link can be cut off (revoked_at) without rotating a secret.
 * Stateless HMAC can later swap in behind these same two functions.
 *
 * The session is just the token in an httpOnly cookie; getSession() re-verifies it
 * against the DB each call (the revocability that retires the bearer-token risk).
 * Server-only — never import from a client component.
 */
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, appMagicLinkTokens } from '@sprigly/db';
import type { LinkClaims } from './types.js';

export const SESSION_COOKIE = 'sprigly_app_session';
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/** Mint a magic-link token for a client+cycle and persist it. Returns the opaque
 *  token string to embed in app.sprigly.co.uk/p/<token>. */
export async function signLink(claims: { clientId: string; cycleId: string; exp?: number }): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(claims.exp ?? Date.now() + DEFAULT_TTL_MS);
  await db.insert(appMagicLinkTokens).values({
    clientId:  claims.clientId,
    cycleId:   claims.cycleId,
    token,
    expiresAt,
  });
  return token;
}

/** Read-only validation: returns claims if the token exists, is not revoked, and
 *  has not expired; otherwise null. Never throws. */
export async function verifyLink(token: string): Promise<LinkClaims | null> {
  if (!token) return null;
  try {
    const [row] = await db
      .select()
      .from(appMagicLinkTokens)
      .where(eq(appMagicLinkTokens.token, token))
      .limit(1);
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return { clientId: row.clientId, cycleId: row.cycleId, exp: row.expiresAt.getTime() };
  } catch {
    return null;
  }
}

/** Record that a link was opened (last_used_at). Best-effort. */
export async function touchLink(token: string): Promise<void> {
  try {
    await db.update(appMagicLinkTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(appMagicLinkTokens.token, token));
  } catch { /* non-fatal */ }
}

/** Revoke a token immediately (admin action / "request a fresh link" later). */
export async function revokeLink(token: string): Promise<void> {
  await db.update(appMagicLinkTokens)
    .set({ revokedAt: new Date() })
    .where(eq(appMagicLinkTokens.token, token));
}

/** Set the session cookie (httpOnly, scoped to the token). */
export function setSessionCookie(token: string, exp: number): void {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    expires:  new Date(exp),
  });
}

/** Resolve the current session from the cookie, re-verifying against the DB. */
export async function getSession(): Promise<LinkClaims | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyLink(token);
}
