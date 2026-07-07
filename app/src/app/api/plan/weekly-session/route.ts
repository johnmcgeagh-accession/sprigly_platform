/**
 * POST /api/plan/weekly-session — trigger a weekly planning session for the
 * caller's cycle and the upcoming week. Magic-link auth; the engine worker runs
 * the audit + generation. Also enqueued by the Monday cron. Body: { weekStart? }.
 */
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { enqueueWeeklySession } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Monday (Europe/London) of the week containing `d`, as 'YYYY-MM-DD'. */
function londonWeekStart(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const dow = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[get('weekday')] ?? 0;
  const local = new Date(`${get('year')}-${get('month')}-${get('day')}T00:00:00Z`);
  local.setUTCDate(local.getUTCDate() - dow);
  return local.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let weekStart = londonWeekStart();
  try {
    const b = (await req.json()) as { weekStart?: unknown };
    if (typeof b.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.weekStart)) weekStart = b.weekStart;
  } catch { /* default week */ }

  const r = await enqueueWeeklySession({ type: 'weekly-session', clientId: session.clientId, cycleId: session.cycleId, weekStart });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
  if ('busy' in r) return NextResponse.json({ mode: 'noop', summary: 'A weekly session for this week is already running.' });
  return NextResponse.json({ mode: 'pending', summary: 'Running your weekly planning session…', jobId: r.jobId, weekStart });
}
