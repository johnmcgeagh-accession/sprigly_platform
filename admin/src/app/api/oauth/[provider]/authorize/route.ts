/**
 * GET /api/oauth/:provider/authorize?clientId=… — kick off Google OAuth for a
 * (clientId, provider) connection. Redirects the admin's browser to Google's
 * consent screen with a signed state. Server-side; no secrets in the browser.
 */
import { NextResponse } from 'next/server';
import { isGoogleProvider, signState, newNonce, redirectUri, buildAuthUrl } from '@/lib/google-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(req: Request, { params }: { params: { provider: string } }) {
  const { provider } = params;
  if (!isGoogleProvider(provider)) return NextResponse.json({ error: 'unknown_provider' }, { status: 400 });

  const clientId = new URL(req.url).searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'missing_clientId' }, { status: 400 });

  const state = signState({ clientId, provider, nonce: newNonce() });
  return NextResponse.redirect(buildAuthUrl(provider, redirectUri(req, provider), state));
}
