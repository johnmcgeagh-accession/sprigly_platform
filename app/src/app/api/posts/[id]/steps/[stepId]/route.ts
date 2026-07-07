/**
 * PATCH  /api/posts/:id/steps/:stepId — toggle done { done: boolean }.
 * DELETE /api/posts/:id/steps/:stepId — remove the step.
 * Scoped server-side to the session's client+cycle; a step ticks the plan_activity
 * ledger. 401 no session, 404 not owned / step not on this post.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { setStepDone, removeStep } from '@/lib/steps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string; stepId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let body: { done?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  if (typeof body.done !== 'boolean') return NextResponse.json({ error: 'bad_patch' }, { status: 400 });

  const steps = await setStepDone(session.clientId, session.cycleId, params.id, params.stepId, body.done);
  if (steps === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ steps });
}

export async function DELETE(_req: Request, { params }: { params: { id: string; stepId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const steps = await removeStep(session.clientId, session.cycleId, params.id, params.stepId);
  if (steps === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ steps });
}
