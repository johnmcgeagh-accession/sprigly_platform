/**
 * GET /api/plan/ideas — every durable input this client has given us, with what became of each.
 * Client-scoped via the magic-link session. Returns { ideas: IdeaView[] }.
 *
 * Read-only by design. The one way to add an idea is still to tell the agent, which already
 * captures it; this route deliberately has no POST, PATCH or DELETE.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listIdeas } from '@/lib/agent/ideas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  return NextResponse.json({ ideas: await listIdeas(session.clientId) });
}
