/**
 * /p/:token — magic-link entry. Verifies the token against app_magic_link_tokens,
 * sets the httpOnly session cookie scoped to that client+cycle, records last_used,
 * and redirects to the plan. An invalid/expired/revoked token redirects to /expired.
 */
import { NextResponse } from 'next/server';
import { verifyLink, touchLink, setSessionCookie } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = params.token;
  const claims = await verifyLink(token);
  if (!claims) {
    return NextResponse.redirect(new URL('/expired', _req.url));
  }
  await touchLink(token);
  setSessionCookie(token, claims.exp);
  return NextResponse.redirect(new URL('/', _req.url));
}
