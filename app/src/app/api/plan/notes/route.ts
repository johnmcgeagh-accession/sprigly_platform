/**
 * GET /api/plan/notes — the client's active plan notes (newest first).
 * Client-scoped via the magic-link session. Returns { notes: NoteView[] }.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listActiveNotes } from '@/lib/agent/notes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const todayIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const notes = await listActiveNotes(session.clientId, todayIso());
  return NextResponse.json({ notes });
}
