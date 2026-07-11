/**
 * PATCH  /api/posts/:id  — date / format / pillar / position / caption (free-text)
 * DELETE /api/posts/:id  — soft-delete
 * Scoped to the session's CLIENT; editability is by scheduled_date (>= today London),
 * across ANY of the client's cycles — not by the token's home cycle. 401 no session,
 * 404 not the client's post, 403 read_only if the post (or a date move's target) is past.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { patchPost, softDeletePost, type PostPatch } from '@/lib/mutations';
import { gatePostEdit, editScopeToday, isEditableDate } from '@/lib/edit-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let body: PostPatch;
  try { body = (await req.json()) as PostPatch; } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  const today = editScopeToday();
  const gate = await gatePostEdit(session.clientId, params.id, today);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  // A date move must land today-onward too (can't move a post INTO the past).
  if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) && !isEditableDate(body.date, today)) {
    return NextResponse.json({ error: 'read_only' }, { status: 403 });
  }

  const result = await patchPost(session.clientId, gate.cycleId, params.id, body, undefined, today);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const today = editScopeToday();
  const gate = await gatePostEdit(session.clientId, params.id, today);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const result = await softDeletePost(session.clientId, gate.cycleId, params.id, undefined, today);
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(result);
}
