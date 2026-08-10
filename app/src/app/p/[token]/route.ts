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
  // Preserve the markers from the touch emails' {{intakeLink}}
  // (…/p/<token>?intake=1&cycle=<cycleId>):
  //   intake=1  — land with the intake capture surface open.
  //   cycle=    — land on the month the touch is ASKING ABOUT, rather than the one the
  //               date-based landing rule picks. The touch fires in the month before the one
  //               it plans, so on the ask day those are different cycles and the client was
  //               being shown (and writing to) the wrong one. Forwarded verbatim; page.tsx
  //               verifies it belongs to this client before honouring it, so an unrecognised
  //               id falls through to the ordinary rule.
  const incoming = new URL(_req.url).searchParams;
  const forwarded = new URLSearchParams();
  if (incoming.get('intake') === '1') forwarded.set('intake', '1');
  const cycle = incoming.get('cycle');
  if (cycle) forwarded.set('cycle', cycle);
  const query = forwarded.toString();
  return NextResponse.redirect(new URL(query ? `/?${query}` : '/', _req.url));
}
