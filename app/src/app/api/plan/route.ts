/**
 * GET /api/plan[?cycleId=] — returns a plan as PlanPost[]. Without a cycleId it
 * serves the session's home cycle (editable). With one, it serves another of the
 * SAME client's cycles read-only — verified server-side: the cycle must belong to
 * the session's client and qualify (isCycleReadableByClient), else 403. A pure
 * read: no cookie/session mutation, and WRITE scope stays the session's home cycle.
 * 401 if no valid session.
 */
import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, contentCycles, clientConfigs, planInputs } from '@sprigly/db';
import type { IntakeJson } from '@sprigly/engine';
import { getSession } from '@/lib/auth';
import { loadPlanPosts, loadCrossMonthPosts, isCycleReadableByClient, beatsInMonth, surfaceForCycle } from '@/lib/plan';
import { summariseSavedBrief } from '@/lib/brief-summary';
import { readPlanRedesignFlag } from '@/lib/flags';
import { nextMonth } from '@/lib/cycle-nav';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'no_session' }, { status: 401 });
  }

  const requested = new URL(req.url).searchParams.get('cycleId');
  const cycleId   = requested ?? session.cycleId;
  const isHome    = cycleId === session.cycleId;

  // The home cycle is always allowed. Any other cycle must be verified to belong to
  // this client and be a valid live surface — otherwise refuse, never leak.
  if (!isHome && !(await isCycleReadableByClient(session.clientId, cycleId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const posts = await loadPlanPosts(session.clientId, cycleId);

  // Calendar grid is date-authoritative: also return the client's posts from OTHER cycles
  // dated within THIS cycle's plan month, so a cross-month-moved post shows on its date in
  // the month view it belongs to (each carries its own cycleId for edit routing).
  const [cyc] = await db
    .select({ channel: contentCycles.channel, cycleMonth: contentCycles.cycleMonth, structuredBrief: contentCycles.structuredBrief, intakeJson: contentCycles.intakeJson })
    .from(contentCycles)
    .where(and(eq(contentCycles.id, cycleId), eq(contentCycles.clientId, session.clientId)))
    .limit(1);
  const viewedMonth = cyc ? nextMonth(cyc.cycleMonth) : '';
  const crossMonthPosts = cyc
    ? await loadCrossMonthPosts(session.clientId, cyc.channel, viewedMonth, cycleId)
    : [];
  // Beats: the VIEWED cycle's structured_brief dated in the viewed month (null-safe → []).
  // Viewed-cycle-only (cross-cycle brief beats not merged — see Build 3 report).
  const beats = cyc ? beatsInMonth(cyc.structuredBrief, viewedMonth) : [];

  // FIX 1: the viewed cycle's saved intake (for the capture form to remember) + the client's
  // active durable context (read-only "remembered for the future" list). Session-scoped.
  const planContent = (cyc?.intakeJson as IntakeJson | null)?.planContent ?? { answers: {}, freeNotes: '' };
  const intake = { answers: planContent.answers ?? {}, freeNotes: planContent.freeNotes ?? '' };
  // What the last extraction TOOK from that brief, for the capture surface's preview panel.
  // Free: `structuredBrief` is already selected above for `beats`, and this is a pure
  // projection of it — no extra query, and emphatically no fresh model call on a page load.
  const savedExtraction = summariseSavedBrief(cyc?.structuredBrief);
  const durableRows = await db
    .select({ id: planInputs.id, type: planInputs.type, content: planInputs.content, createdAt: planInputs.createdAt })
    .from(planInputs)
    .where(and(eq(planInputs.clientId, session.clientId), inArray(planInputs.type, ['idea', 'next_cycle']), eq(planInputs.status, 'active')))
    .orderBy(desc(planInputs.createdAt));
  const durable = durableRows.map((r) => ({ id: r.id, type: r.type, content: r.content, createdAt: r.createdAt.toISOString() }));

  // SURFACE KIND for the REQUESTED cycle, computed with the same helper the first paint
  // uses (plan.ts surfaceForCycle). Without this the client had no way back into draft
  // mode once it had left it: the shell was chosen server-side at landing and the month
  // switch could only ever swap data inside it
  // (docs/reports/draft-mode-not-rendering.md §3).
  const [cfg] = await db
    .select({ settings: clientConfigs.settings })
    .from(clientConfigs)
    .where(eq(clientConfigs.clientId, session.clientId))
    .limit(1);
  const { kind: surfaceKind } = await surfaceForCycle({
    clientId:           session.clientId,
    cycleId,
    committedPostCount: posts.length,
    planRedesign:       readPlanRedesignFlag(cfg?.settings),
  });

  return NextResponse.json({ posts, crossMonthPosts, beats, intake, savedExtraction, durable, surfaceKind, readOnly: !isHome });
}
