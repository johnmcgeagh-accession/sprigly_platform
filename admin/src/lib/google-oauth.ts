import 'server-only';
import crypto from 'node:crypto';

/**
 * google-oauth.ts — server-side Google OAuth for the admin reconnect flow. Raw
 * fetch against Google's endpoints (no googleapis dep). Client secret never leaves
 * the server; the browser only ever sees the Google consent redirect. Mirrors the
 * scopes of the CLI setup scripts (setup-gmail-oauth.ts / setup-drive-oauth.ts).
 */

export type GoogleProvider = 'gmail' | 'drive';

export const PROVIDER_SCOPES: Record<GoogleProvider, string[]> = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
  ],
  drive: ['https://www.googleapis.com/auth/drive.file'],
};

export function isGoogleProvider(p: string): p is GoogleProvider {
  return p === 'gmail' || p === 'drive';
}

function clientSecret(): string {
  const s = process.env.GOOGLE_CLIENT_SECRET;
  if (!s) throw new Error('GOOGLE_CLIENT_SECRET not set');
  return s;
}

/** The redirect URI must match EXACTLY between authorize and token exchange, and be
 *  registered in Google Cloud. Prefer ADMIN_BASE_URL; fall back to the request origin
 *  (fine for localhost:3100 dev). */
export function redirectUri(req: Request, provider: GoogleProvider): string {
  const base = (process.env.ADMIN_BASE_URL ?? new URL(req.url).origin).replace(/\/$/, '');
  return `${base}/api/oauth/${provider}/callback`;
}

// ── Signed state (CSRF + carries clientId/provider) ─────────────────────────────
interface StatePayload { clientId: string; provider: GoogleProvider; nonce: string }

export function signState(payload: StatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', clientSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(state: string): StatePayload | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', clientSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    if (typeof parsed?.clientId === 'string' && isGoogleProvider(parsed.provider)) return parsed;
  } catch { /* fallthrough */ }
  return null;
}

export function newNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

// ── Authorize URL ───────────────────────────────────────────────────────────────
export function buildAuthUrl(provider: GoogleProvider, redirect: string, state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID not set');
  const params = new URLSearchParams({
    client_id:              clientId,
    redirect_uri:           redirect,
    response_type:          'code',
    access_type:            'offline',  // request a refresh token
    prompt:                 'consent',  // force a fresh refresh token on every reconnect
    include_granted_scopes: 'true',
    scope:                  PROVIDER_SCOPES[provider].join(' '),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ── Token exchange + account email ──────────────────────────────────────────────
export interface GoogleTokens { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }

export async function exchangeCode(code: string, redirect: string): Promise<GoogleTokens> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: clientSecret(),
      redirect_uri:  redirect,
      grant_type:    'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as GoogleTokens;
}

/** Best-effort: resolve the authorised account's email (gmail profile / drive about). */
export async function fetchAccountEmail(provider: GoogleProvider, accessToken: string): Promise<string | undefined> {
  try {
    const url = provider === 'gmail'
      ? 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
      : 'https://www.googleapis.com/drive/v3/about?fields=user';
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) return undefined;
    const d = (await r.json()) as { emailAddress?: string; user?: { emailAddress?: string } };
    return provider === 'gmail' ? d.emailAddress : d.user?.emailAddress;
  } catch { return undefined; }
}
