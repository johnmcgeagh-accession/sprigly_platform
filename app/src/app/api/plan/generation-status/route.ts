/**
 * GET /api/plan/generation-status[?cycleId=] — is this month still being written?
 *
 * ── What this closes ─────────────────────────────────────────────────────────────────
 *
 * Nothing invalidated client state when a generation run finished. `usePlanData` refetches
 * from client-initiated writes and a cycle switch; `pollJob` follows a job the CLIENT started
 * and holds the id of. A monthly run is started by the worker, returns no job ids to the page
 * (approve/route.ts hands back counts), and touches nothing the page subscribes to. So the
 * first few captions rendered — they were in the payload the page had already loaded — and
 * every later one did not. A real run measured on uat wrote 28 captions over 311 seconds, all
 * of them invisible until a manual refresh.
 *
 * The ring the client stared at was a correct render of stale rows: CommittedSurface maps
 * 'generating' | 'generation_failed' → 'onway'.
 *
 * ── Why a separate route rather than re-polling /api/plan ────────────────────────────
 *
 * Measured on uat: this aggregate is ~0.2ms over one index scan. `/api/plan` for a committed
 * month is seven sequential queries and ~59kB of rows, 28kB of it caption/hook/script text.
 * A 311-second run at the poll interval is ~195 requests, so the difference between the two is
 * the difference between a rounding error and re-sending the month two hundred times. The
 * plan itself is refetched only when this says something actually changed — about 28 times
 * over that run, not 195.
 *
 * A pure read, session-scoped exactly like /api/plan: the home cycle is always allowed, any
 * other must belong to this client and be a readable surface, else 403 and never a leak.
 */
import { NextResponse } from 'next/server';
import { db, readGenerationStatus } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { isCycleReadableByClient } from '@/lib/plan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  const requested = new URL(req.url).searchParams.get('cycleId');
  const cycleId   = requested ?? session.cycleId;

  if (cycleId !== session.cycleId && !(await isCycleReadableByClient(session.clientId, cycleId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  return NextResponse.json(await readGenerationStatus(db, cycleId));
}
