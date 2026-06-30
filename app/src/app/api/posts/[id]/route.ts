/**
 * PATCH  /api/posts/:id  — date / format / pillar / position / caption (free-text)
 * DELETE /api/posts/:id  — soft-delete
 * Both scoped server-side to the session's cycle; 401 no session, 404 not owned.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { patchPost, softDeletePost, type PostPatch } from '@/lib/mutations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let body: PostPatch;
  try { body = (await req.json()) as PostPatch; } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  const result = await patchPost(session.clientId, session.cycleId, params.id, body);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const result = await softDeletePost(session.clientId, session.cycleId, params.id);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}
