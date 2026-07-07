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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const [row] = await db
    .select({ sourceMeta: contentCyclePosts.sourceMeta })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.id, params.id),
      eq(contentCyclePosts.cycleId, session.cycleId),
      eq(contentCyclePosts.clientId, session.clientId),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const meta = (row.sourceMeta ?? {}) as Record<string, unknown>;
  const instruction = typeof meta.pendingInstruction === 'string' ? meta.pendingInstruction.trim() : '';
  if (!instruction) return NextResponse.json({ error: 'no_instruction' }, { status: 400 });

  const gen = await startPostGeneration(session.clientId, session.cycleId, params.id, instruction);
  if ('blocked' in gen) return NextResponse.json({ mode: 'blocked', summary: gen.message });
  if ('error' in gen) return NextResponse.json({ error: gen.error }, { status: 503 });
  return NextResponse.json({ mode: 'pending', summary: 'Sprigly is writing this…', jobId: gen.jobId });
}
