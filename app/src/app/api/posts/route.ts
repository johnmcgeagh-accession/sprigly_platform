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
import { addGeneratingPost } from '@/lib/mutations';
import { startPostGeneration, enqueueFollowOnGeneration } from '@/lib/post-generation';
import { loadPlanPosts } from '@/lib/plan';
import { titleFromSubject } from '@/lib/agent/selectors';
import { editScopeToday, canAddPost } from '@/lib/edit-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMAT_WORD: Record<string, string> = { reel: 'reel', carousel: 'carousel', single: 'single image post' };

/**
 * The brief for an add with no subject.
 *
 * It says only what the client's own act said: this day, this format. No topic is invented — the
 * generator writes from the client's voice and their plan context, which is what it does for
 * every other post in the month. An empty instruction would have been rejected by
 * `startPostGeneration`; a placeholder caption was the alternative, and it was worse.
 */
function defaultCaptionBrief(date: string, format: string): string {
  return `Write a caption for a ${FORMAT_WORD[format] ?? 'post'} going out on ${date}. `
    + 'No subject was given, so choose one that fits this client’s voice and the rest of the month.';
}

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

  /**
   * CAPTION GENERATION ENQUEUES REGARDLESS; AN INSTRUCTION ONLY STEERS IT.
   *
   * The old branch here left a subject-less add holding `DRAFT_PLACEHOLDER_CAPTION` — a column
   * that is not empty and content that does not exist. Two things then read that string as a
   * caption: the detail sheet showed it in a tab, and `/api/plan/script` accepted it as the
   * subject for a reel's hook and script. The operator got both, written about our own
   * scaffolding sentence, on a post they would have said had no caption.
   *
   * So there is one path now. Without a subject the brief is a neutral one derived from the slot
   * itself — which is exactly what the client asked for by adding a post to that day in that
   * format, and nothing more. The post reads *On its way* until the words land, which is true.
   */
  const brief = instruction || defaultCaptionBrief(date, format || 'single');

  // The slot is taken NOW and the caption is written into it. Two calls, in this order, for the
  // reason the sweep records: a post marked generating with nothing enqueued reads as work in
  // flight that no process owns.
  const created = await addGeneratingPost(
    session.clientId, targetCycleId,
    // The subject the client typed is the slot title (X3) — the same rule the agent add path
    // follows, so a post added by hand and a post added by conversation are headed the same way.
    // A subject-less add has no title, and the card says so rather than borrowing our own brief.
    { channel: cycle.channel, date, instruction: brief, format: format || null, title: titleFromSubject(instruction) },
    undefined, today,
  );
  if (!created) return NextResponse.json({ error: 'read_only' }, { status: 403 });

  const gen = await startPostGeneration(session.clientId, targetCycleId, created.postId, brief, today);
  // THE FULL GENERATION (F5): an added carousel's hook is enqueued alongside its caption —
  // same parity as the agent add path and the phase-2 fan-out. A reel's combined hook+script
  // is the worker's job the moment the caption lands (script-ready.ts); singles need nothing.
  await enqueueFollowOnGeneration(session.clientId, targetCycleId, created.postId, format || 'single');
  // A blocked quota or a failed enqueue leaves the post in `generation_failed` with its
  // instruction kept — startPostGeneration stamps that itself. The post still exists and the
  // client still sees "On its way", because the sweep will pick it up; nothing here pretends
  // otherwise and nothing here is rolled back.
  const summary = 'blocked' in gen ? gen.message : 'Added it — we’re writing it now.';
  const posts = await loadPlanPosts(session.clientId, targetCycleId);
  return NextResponse.json({ mode: 'applied', summary, changedPostIds: [created.postId], posts });
}
