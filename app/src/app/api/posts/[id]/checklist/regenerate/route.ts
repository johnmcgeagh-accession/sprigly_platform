/**
 * POST /api/posts/:id/checklist/regenerate — REPLACE the checklist with the post's current
 * format template (Stage 6 format editing). Deletes existing steps first. 422 no_template
 * for formats without one (email → checklist cleared). Scoped to the session's client+cycle.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { regenerateChecklist } from '@/lib/steps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const result = await regenerateChecklist(session.clientId, session.cycleId, params.id);
  switch (result.status) {
    case 'not_found':   return NextResponse.json({ error: 'not_found' }, { status: 404 });
    case 'created':     return NextResponse.json({ steps: result.steps });
    default:            return NextResponse.json({ steps: [] });   // no_template (email) — checklist cleared
  }
}
