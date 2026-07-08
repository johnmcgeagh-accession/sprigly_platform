/**
 * POST /api/plan/events — record one UI telemetry event for the session's client.
 * Session-scoped; event names are allow-listed. Best-effort (ui_events), never blocks.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { recordUiEvent, UI_EVENTS } from '@/lib/telemetry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set<string>(UI_EVENTS);

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let body: { event?: unknown; payload?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  const event = String(body.event ?? '');
  if (!ALLOWED.has(event)) return NextResponse.json({ error: 'bad_event' }, { status: 400 });

  const payload = body.payload && typeof body.payload === 'object' ? (body.payload as Record<string, unknown>) : undefined;
  await recordUiEvent(session.clientId, event, payload);
  return NextResponse.json({ ok: true });
}
