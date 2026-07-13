/**
 * POST /api/plan/weekly-session — trigger a weekly planning session for the VIEWED
 * cycle and the upcoming week. Magic-link auth; the engine worker runs the audit +
 * generation. Body: { cycleId?, weekStart? }.
 *
 * The session runs against the cycle the client is VIEWING (usePlanData sends the viewed
 * cycleId), NOT the token's home (session.cycleId) — the old anchor targeted home even
 * when the user was looking at another month, the same bug class as the hooks/jobs
 * incident. The cycleId is validated for client ownership (same guard as /api/jobs) and
 * must be in an AUDITABLE status — the SAME eligibility the Monday cron fan-out enforces
 * (engine weekly-cron.ts: AUDITABLE_STATUSES) — so a manual trigger can't run against a
 * cycle the cron would never pick. An unowned cycle 403s; an ineligible one returns a
 * clear noop. Absent cycleId ⇒ the session's home cycle. Also enqueued by the Monday cron.
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { enqueueWeeklySession } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cycle statuses live/editable enough to audit weekly — MIRRORS AUDITABLE_STATUSES in the
// engine's weekly-cron.ts fan-out, so the manual trigger and the Monday cron agree on which
// cycles are eligible. Keep the two lists in lockstep.
const AUDITABLE_STATUSES: ReadonlyArray<string> = ['active', 'delivered', 'finalised'];

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
  let requestedCycleId: string | null = null;
  try {
    const b = (await req.json()) as { weekStart?: unknown; cycleId?: unknown };
    if (typeof b.weekStart === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.weekStart)) weekStart = b.weekStart;
    if (typeof b.cycleId === 'string' && b.cycleId) requestedCycleId = b.cycleId;
  } catch { /* default week + home cycle */ }

  // Target the viewed cycle when sent, else home. Either way it must belong to the client
  // (ownership guard) AND be auditable (same rule as the cron) before we enqueue against it.
  const cycleId = requestedCycleId ?? session.cycleId;
  const [cyc] = await db
    .select({ id: contentCycles.id, status: contentCycles.status })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, session.clientId)))
    .limit(1);
  if (!cyc) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!AUDITABLE_STATUSES.includes(cyc.status)) {
    return NextResponse.json({ mode: 'noop', summary: 'This month isn’t ready for a weekly review yet.' }, { status: 409 });
  }

  const r = await enqueueWeeklySession({ type: 'weekly-session', clientId: session.clientId, cycleId, weekStart });
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 503 });
  if ('busy' in r) return NextResponse.json({ mode: 'noop', summary: 'A weekly session for this week is already running.' });
  return NextResponse.json({ mode: 'pending', summary: 'Running your weekly planning session…', jobId: r.jobId, weekStart });
}
