/**
 * POST /api/posts — add a draft post (status 'new') at a date, into ONE of the client's
 * cycles (body.cycleId — the month being viewed; defaults to the session cycle). Creation
 * is allowed only for dates >= today (London): you can't add a post in the past. The
 * target cycle is verified to belong to the session's client; the channel comes from that
 * cycle, never the client. 401 no session, 404 bad cycle, 403 read_only (past date).
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { addDraft } from '@/lib/mutations';
import { editScopeToday, isEditableDate } from '@/lib/edit-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let date = '', cycleId = '';
  try {
    const b = (await req.json()) as { date?: unknown; cycleId?: unknown };
    date    = String(b.date ?? '');
    cycleId = String(b.cycleId ?? '');
  } catch { /* validated below */ }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'bad_date' }, { status: 400 });
  }
  const today = editScopeToday();
  if (!isEditableDate(date, today)) {
    return NextResponse.json({ error: 'read_only' }, { status: 403 });
  }

  // Target cycle = the viewed month (body.cycleId), else the session cycle. Either way it
  // MUST belong to the session's client — never trust a bare id.
  const targetCycleId = cycleId || session.cycleId;
  const [cycle] = await db
    .select({ channel: contentCycles.channel })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, targetCycleId), eq(contentCycles.clientId, session.clientId)))
    .limit(1);
  if (!cycle) return NextResponse.json({ error: 'no_cycle' }, { status: 404 });

  const result = await addDraft(session.clientId, targetCycleId, cycle.channel, date, undefined, 'single', today);
  if (!result) return NextResponse.json({ error: 'read_only' }, { status: 403 });
  return NextResponse.json(result);
}
