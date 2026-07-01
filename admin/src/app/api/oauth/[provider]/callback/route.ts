/**
 * GET /api/oauth/:provider/callback — Google redirects here with ?code. Exchange it
 * server-side, store the encrypted refresh token via storeTokens (which resets the
 * connection to status='active' + clears the error, so the poller storm stops), then
 * bounce back to the connections panel. Secrets never touch the browser.
 */
import { NextResponse } from 'next/server';
import { db } from '@sprigly/db';
import { storeTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import type { OAuthTokenBundle } from '@sprigly/oauth-tokens';
import { isGoogleProvider, verifyState, redirectUri, exchangeCode, fetchAccountEmail, PROVIDER_SCOPES } from '@/lib/google-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function back(req: Request, query: string): NextResponse {
  const base = (process.env.ADMIN_BASE_URL ?? new URL(req.url).origin).replace(/\/$/, '');
  return NextResponse.redirect(`${base}/admin/mailboxes?${query}`);
}

export async function GET(req: Request, { params }: { params: { provider: string } }) {
  const { provider } = params;
  if (!isGoogleProvider(provider)) return back(req, 'oauth_error=unknown_provider');

  const url   = new URL(req.url);
  const gErr  = url.searchParams.get('error');
  if (gErr) return back(req, `oauth_error=${encodeURIComponent(gErr)}`);

  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return back(req, 'oauth_error=missing_code');

  const verified = verifyState(state);
  if (!verified || verified.provider !== provider) return back(req, 'oauth_error=bad_state');

  try {
    const redirect = redirectUri(req, provider);
    const tokens   = await exchangeCode(code, redirect);

    // Fail loudly if Google returned no refresh token — an access-only bundle expires
    // in ~1h and re-creates the storm. prompt=consent should always return one; if it
    // didn't, the account likely needs its prior grant revoked, so surface it.
    if (!tokens.refresh_token) return back(req, 'oauth_error=no_refresh_token');

    const email  = await fetchAccountEmail(provider, tokens.access_token);
    const bundle: OAuthTokenBundle = {
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      scopes:       tokens.scope ? tokens.scope.split(' ') : PROVIDER_SCOPES[provider],
      ...(tokens.expires_in ? { expiresAt: Date.now() + tokens.expires_in * 1000 } : {}),
      ...(email ? { emailAddress: email } : {}),
    };
    await storeTokens(db, createEncryptionProvider(), verified.clientId, provider, bundle);
    return back(req, `oauth_connected=${provider}`);
  } catch (err) {
    return back(req, `oauth_error=${encodeURIComponent(String(err).slice(0, 140))}`);
  }
}
