/**
 * /api/plan/conversation — the sheet's thread.
 *
 * ── PER SESSION, not per month (operator ruling, round 2) ────────────────────────────
 *
 * POST starts a conversation for the viewed cycle and returns its id: one per sheet open. The
 * sheet then opens on the framing turn with nothing else in it, and every turn of that session
 * carries the id back — which is also the context window the parser reads, so "move it back"
 * resolves against THIS session and never against a reference three weeks old.
 *
 * GET reads a conversation's turns BY ID. It is what a reopen of the same session uses (the
 * sheet remounting while the client is still in it); it can no longer be asked "what has this
 * month ever said", because that question is what round 1 answered with a wall of history.
 * Prior conversations stay in `agent_messages` under their own rows — stored, not rendered.
 *
 * The cycle id comes from the browser, so it is checked, not trusted — the same rule the agent
 * route follows.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { cycleBelongsToClient } from '@/lib/agent/cycle-state';
import { startConversation, listTurns } from '@/lib/agent/conversation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The viewed cycle, verified to be this client's; falls back to the session's own. */
async function resolveCycle(clientId: string, sessionCycleId: string, requested: string | null): Promise<string> {
  return requested && requested !== sessionCycleId && (await cycleBelongsToClient(clientId, requested))
    ? requested
    : sessionCycleId;
}

/** Open a session: a fresh conversation for this cycle. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let requested: string | null = null;
  try { requested = String(((await req.json()) as { cycleId?: unknown }).cycleId ?? '') || null; } catch { /* body optional */ }
  const cycleId = await resolveCycle(session.clientId, session.cycleId, requested);

  return NextResponse.json({ conversationId: await startConversation(session.clientId, cycleId), turns: [] });
}

/** Read one conversation's turns. `id` is required — a session, not a month. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Ownership is enforced inside listTurns by the join — a conversation that is not this
  // client's returns nothing rather than leaking that it exists.
  return NextResponse.json({ conversationId: id, turns: await listTurns(session.clientId, id) });
}
