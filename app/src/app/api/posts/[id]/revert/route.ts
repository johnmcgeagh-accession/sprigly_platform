/**
 * POST /api/posts/:id/revert — restore a post from source_meta.original (or remove
 * it if it was an added draft). Scoped to the session's cycle.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { revertPost } from '@/lib/mutations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const result = await revertPost(session.clientId, session.cycleId, params.id);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}
