/**
 * POST /api/posts — add a draft post (status 'new') at a date. The channel comes
 * from the session's cycle, never the client. 401 no session.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { addDraft } from '@/lib/mutations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let date = '';
  try { date = String(((await req.json()) as { date?: unknown }).date ?? ''); } catch { /* default below */ }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'bad_date' }, { status: 400 });
  }

  const [cycle] = await db
    .select({ channel: contentCycles.channel })
    .from(contentCycles)
    .where(eq(contentCycles.id, session.cycleId))
    .limit(1);
  if (!cycle) return NextResponse.json({ error: 'no_cycle' }, { status: 404 });

  const result = await addDraft(session.clientId, session.cycleId, cycle.channel, date);
  return NextResponse.json(result);
}
