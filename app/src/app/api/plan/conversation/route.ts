/**
 * GET /api/plan/conversation?cycleId= — the viewed month's thread, for the conversation sheet.
 *
 * Returns the cycle's conversation (its latest, which `ensureConversation` also attaches turns
 * to) and its recent turns, oldest first. Each assistant turn that carried an interpretation
 * returns its stored `items`, so a reopened sheet re-renders the same resolved lines it showed
 * live — never re-derived from proposal payloads. Read-only; the smallest honest storage is the
 * tables every turn already wrote (`conversations` / `agent_messages`), and this is their read
 * path.
 *
 * The cycle id comes from the browser (the month ON SCREEN), so it is checked, not trusted —
 * same rule as the agent route.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { cycleBelongsToClient } from '@/lib/agent/cycle-state';
import { resolveCycleConversation, listTurns } from '@/lib/agent/conversation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const url = new URL(req.url);
  const requested = url.searchParams.get('cycleId') ?? '';
  const cycleId =
    requested && requested !== session.cycleId && (await cycleBelongsToClient(session.clientId, requested))
      ? requested
      : session.cycleId;

  const conversationId = await resolveCycleConversation(session.clientId, cycleId);
  if (!conversationId) return NextResponse.json({ conversationId: null, turns: [] });

  const turns = await listTurns(session.clientId, conversationId);
  return NextResponse.json({ conversationId, turns });
}
