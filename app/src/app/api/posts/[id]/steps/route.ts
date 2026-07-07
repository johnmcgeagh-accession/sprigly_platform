/**
 * GET  /api/posts/:id/steps — the post's checklist steps (batched read).
 * POST /api/posts/:id/steps — add a step { label, leadDays }.
 * Both scoped server-side to the session's client+cycle; 401 no session, 404 not owned.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listStepsForPost, addStep } from '@/lib/steps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const steps = await listStepsForPost(session.clientId, session.cycleId, params.id);
  if (steps === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ steps });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let body: { label?: unknown; leadDays?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }

  const label = String(body.label ?? '').trim();
  const leadDays = Number(body.leadDays);
  if (!label || !Number.isFinite(leadDays) || leadDays < 0) {
    return NextResponse.json({ error: 'bad_step' }, { status: 400 });
  }

  const steps = await addStep(session.clientId, session.cycleId, params.id, { label, leadDays });
  if (steps === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ steps });
}
