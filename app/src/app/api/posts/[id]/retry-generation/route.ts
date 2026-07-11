/**
 * POST /api/posts/:id/retry-generation — re-run async caption generation for a
 * post whose generation failed. Reuses the preserved instruction from source_meta
 * (never trusts client input for it). Quota is re-checked in startPostGeneration.
 * Session-scoped. Returns the pending/blocked branch, mirroring /shape.
 */
import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db, contentCyclePosts } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { startPostGeneration } from '@/lib/post-generation';
import { gatePostEdit, editScopeToday } from '@/lib/edit-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  // DATE POLICY: gate by the post's date + resolve its real cycle.
  const today = editScopeToday();
  const gate = await gatePostEdit(session.clientId, params.id, today);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const [row] = await db
    .select({ sourceMeta: contentCyclePosts.sourceMeta })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.id, params.id),
      eq(contentCyclePosts.cycleId, gate.cycleId),
      eq(contentCyclePosts.clientId, session.clientId),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const meta = (row.sourceMeta ?? {}) as Record<string, unknown>;
  const instruction = typeof meta.pendingInstruction === 'string' ? meta.pendingInstruction.trim() : '';
  if (!instruction) return NextResponse.json({ error: 'no_instruction' }, { status: 400 });

  const gen = await startPostGeneration(session.clientId, gate.cycleId, params.id, instruction, today);
  if ('blocked' in gen) return NextResponse.json({ mode: 'blocked', summary: gen.message });
  if ('readOnly' in gen) return NextResponse.json({ error: 'read_only' }, { status: 403 });
  if ('error' in gen) return NextResponse.json({ error: gen.error }, { status: 503 });
  return NextResponse.json({ mode: 'pending', summary: 'Sprigly is writing this…', jobId: gen.jobId });
}
