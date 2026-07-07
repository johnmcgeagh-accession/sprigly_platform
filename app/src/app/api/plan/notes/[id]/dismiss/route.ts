/**
 * POST /api/plan/notes/:id/dismiss — dismiss an active note. Client-scoped.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dismissNote } from '@/lib/agent/notes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });
  const note = await dismissNote(session.clientId, params.id);
  if (!note) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ note });
}
