/**
 * POST /api/posts — add a post at a date, into ONE of the client's cycles (body.cycleId — the
 * month being viewed; defaults to the session cycle). Creation is allowed only for dates >=
 * today (London): you can't add a post in the past. The target cycle is verified to belong to
 * the session's client; the channel comes from that cycle, never the client. 401 no session,
 * 404 bad cycle, 403 read_only (past date).
 *
 * ── Round 6, P1: the add slot creates a SHAPED post ──────────────────────────────────
 *
 * Two optional fields, both from the add sheet:
 *
 *   format       reel | carousel | single. Was hard-coded 'single', so every post the client
 *                added started as the wrong thing and had to be corrected afterwards.
 *   instruction  what the post is about. With it, the post occupies its slot immediately as
 *                'generating' and a shape job writes the caption — the same pair of calls the
 *                agent's create-with-instruction proposal already makes
 *                (`addGeneratingPost` + `startPostGeneration`, agent/proposals.ts). Without it,
 *                the old behaviour: an empty slot, now reached deliberately rather than by
 *                default.
 *
 * Attribution: both paths are the client's own hand, so the ledger says `client` — the actor
 * defaults in `addGeneratingPost` and `startPostGeneration` are exactly that (0090).
 */
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, contentCycles } from '@sprigly/db';
import { getSession } from '@/lib/auth';
import { addDraft, addGeneratingPost } from '@/lib/mutations';
import { startPostGeneration } from '@/lib/post-generation';
import { loadPlanPosts } from '@/lib/plan';
import { editScopeToday, canAddPost } from '@/lib/edit-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let date = '', cycleId = '', format = '', instruction = '';
  try {
    const b = (await req.json()) as { date?: unknown; cycleId?: unknown; format?: unknown; instruction?: unknown };
    date        = String(b.date ?? '');
    cycleId     = String(b.cycleId ?? '');
    format      = typeof b.format === 'string' ? b.format : '';
    instruction = typeof b.instruction === 'string' ? b.instruction.trim() : '';
  } catch { /* validated below */ }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'bad_date' }, { status: 400 });
  }
  const today = editScopeToday();
  if (!canAddPost(date, today)) {
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

  // No subject → an empty slot, exactly as before. `addDraft` validates the format itself and
  // falls back to 'single', so a nonsense value cannot land in the column.
  if (!instruction) {
    const result = await addDraft(session.clientId, targetCycleId, cycle.channel, date, undefined, format || 'single', today);
    if (!result) return NextResponse.json({ error: 'read_only' }, { status: 403 });
    return NextResponse.json(result);
  }

  // A subject → the slot is taken NOW and the caption is written into it. Two calls, in this
  // order, for the reason the sweep records: a post marked generating with nothing enqueued
  // reads as work in flight that no process owns.
  const created = await addGeneratingPost(
    session.clientId, targetCycleId,
    { channel: cycle.channel, date, instruction, format: format || null },
    undefined, today,
  );
  if (!created) return NextResponse.json({ error: 'read_only' }, { status: 403 });

  const gen = await startPostGeneration(session.clientId, targetCycleId, created.postId, instruction, today);
  // A blocked quota or a failed enqueue leaves the post in `generation_failed` with its
  // instruction kept — startPostGeneration stamps that itself. The post still exists and the
  // client still sees "On its way", because the sweep will pick it up; nothing here pretends
  // otherwise and nothing here is rolled back.
  const summary = 'blocked' in gen ? gen.message : 'Added it — we’re writing it now.';
  const posts = await loadPlanPosts(session.clientId, targetCycleId);
  return NextResponse.json({ mode: 'applied', summary, changedPostIds: [created.postId], posts });
}
