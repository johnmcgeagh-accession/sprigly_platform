/**
 * POST /api/posts/:id/revert — restore a post from source_meta.original (or remove
 * it if it was an added draft). Scoped to the session's cycle.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { revertPost } from '@/lib/mutations';
import { gatePostEdit, editScopeToday } from '@/lib/edit-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const today = editScopeToday();
  const gate = await gatePostEdit(session.clientId, params.id, today);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const result = await revertPost(session.clientId, gate.cycleId, params.id, undefined, today);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}
