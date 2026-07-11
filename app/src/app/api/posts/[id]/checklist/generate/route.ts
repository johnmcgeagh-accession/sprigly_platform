/**
 * POST /api/posts/:id/checklist/generate — instantiate the checklist from the
 * step_templates row for the post's format. Idempotent: 409 if steps already exist
 * (a double-click never doubles the checklist). Scoped to the session's client+cycle.
 *
 * (Route path uses /checklist/generate rather than the plan's `checklist:generate` —
 * Next.js file routing can't express a ':' segment. Recorded in design/DECISIONS.md.)
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { generateChecklist } from '@/lib/steps';
import { gatePostEdit, editScopeToday } from '@/lib/edit-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const today = editScopeToday();
  const gate = await gatePostEdit(session.clientId, params.id, today);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const result = await generateChecklist(session.clientId, gate.cycleId, params.id, undefined, today);
  switch (result.status) {
    case 'not_found':   return NextResponse.json({ error: 'not_found' }, { status: 404 });
    case 'exists':      return NextResponse.json({ error: 'checklist_exists' }, { status: 409 });
    case 'no_template': return NextResponse.json({ error: 'no_template' }, { status: 422 });
    default:            return NextResponse.json({ steps: result.steps });
  }
}
