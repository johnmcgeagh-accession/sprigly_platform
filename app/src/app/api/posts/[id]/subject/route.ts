/**
 * POST /api/posts/:id/subject — the way back from a DECLINED launch beat.
 *
 * `phase2` stands a launch beat down when its product is in no catalogue, because a launch
 * post's whole job is to name the thing launching and nothing downstream can tell a real
 * product name from an invented one. The card then asks the client what it is. This is where
 * that answer lands, and it is the only door that clears the flag.
 *
 * ── WHY THIS IS NOT `/shape`, AND NOT `/retry-generation` ────────────────────────────
 *
 * `/shape` REWRITES a caption that exists. This post has none — that is the whole point — and
 * shape's own contract is a refine of a field.
 *
 * `/retry-generation` re-runs the instruction the post already carries and deliberately
 * "never trusts client input for it". Re-running THIS post's instruction would be re-running
 * the brief that was declined, which would be declined again. The client's sentence is new
 * information, and it has to be allowed in.
 *
 * ── THE FLAG IS THE AUTHORISATION ───────────────────────────────────────────────────
 *
 * This accepts client text and turns it into a generation brief, so it must not become a
 * general-purpose "write me anything" door. It refuses any post that is not actually waiting on
 * this question. That check is the scope, not the date gate.
 */
import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db, contentCyclePosts } from '@sprigly/db';
import {
  captionInstruction, beatSubject, isSubjectUngrounded, ungroundedSubjectOf,
  UNGROUNDED_KEY, UNGROUNDED_SUBJECT_KEY,
} from '@sprigly/engine/generation-recovery';
import { getSession } from '@/lib/auth';
import { startPostGeneration } from '@/lib/post-generation';
import { gatePostEdit, editScopeToday } from '@/lib/edit-scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What a client may say about a product. Long enough for a real description, bounded so this
 *  is not a free channel into a generation prompt. */
const MAX_SUBJECT_CHARS = 600;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'no_session' }, { status: 401 });

  let answer = '';
  try {
    const b = (await req.json()) as { subject?: unknown };
    answer = String(b.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT_CHARS);
  } catch { /* below */ }
  if (!answer) return NextResponse.json({ error: 'no_subject' }, { status: 400 });

  const today = editScopeToday();
  const gate = await gatePostEdit(session.clientId, params.id, today);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const [row] = await db
    .select({
      sourceMeta: contentCyclePosts.sourceMeta,
      beatMeta:   contentCyclePosts.beatMeta,
      pillar:     contentCyclePosts.pillar,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.id, params.id),
      eq(contentCyclePosts.cycleId, gate.cycleId),
      eq(contentCyclePosts.clientId, session.clientId),
      isNull(contentCyclePosts.deletedAt),
    ))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!isSubjectUngrounded(row.sourceMeta)) {
    return NextResponse.json({ error: 'not_awaiting_subject' }, { status: 409 });
  }

  const meta = (row.sourceMeta ?? {}) as Record<string, unknown>;
  const title = typeof meta['title'] === 'string' ? meta['title'] : '';
  const name = ungroundedSubjectOf(row.sourceMeta);

  /**
   * The brief, built from BOTH halves of what the client has told us: the sentence that placed
   * the beat (`beat_meta`, via `beatSubject`) and the sentence just typed. They answer different
   * questions — when it launches, and what it IS — and the caption needs both. Routed through
   * `captionInstruction` so the answer inherits the same framing every other subject gets rather
   * than arriving as a loose instruction to obey.
   */
  const placed = beatSubject(row.beatMeta);

  /**
   * Two details the assembled prompt made obvious, both worth keeping:
   *
   * NEWLINE, NOT A SPACE. Joined with a space the two sentences run together mid-clause —
   * "…and 2 teasers on the lead up Molly is a midweight…" — which reads as one garbled sentence
   * rather than two facts. They are separate statements made at separate times.
   *
   * NO "Molly is:" PREFIX WHEN THEY ALREADY SAID IT. Asked "What is Molly?", a client naturally
   * answers "Molly is a midweight organic cotton T shirt", and labelling that produces
   * "Molly is: Molly is a midweight…". The label exists to bind an unlabelled answer ("a
   * midweight cotton tee") to the name it describes, so it is added only when it is doing that.
   */
  const named = name && !new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(answer)
    ? `${name} is: ${answer}`
    : answer;
  const subject = [placed, named].filter(Boolean).join('\n');
  const instruction = captionInstruction(title, row.pillar ?? '', subject);

  /**
   * CLEAR THE FLAG BEFORE ENQUEUEING, not after the caption lands.
   *
   * The question HAS been answered — that is true the moment they answer it, and it stays true
   * whether or not the generation then succeeds. Leaving the flag up until success would ask
   * the same question again over a post that is visibly being written, and a failure afterwards
   * has its own honest state to fall into ('generating' → the sweep → 'On its way'). The answer
   * itself is not lost either way: `startPostGeneration` writes it to `pendingInstruction`,
   * which is what every retry path reads.
   */
  const cleared = { ...meta };
  delete cleared[UNGROUNDED_KEY];
  delete cleared[UNGROUNDED_SUBJECT_KEY];
  await db.update(contentCyclePosts)
    .set({ sourceMeta: cleared })
    .where(and(
      eq(contentCyclePosts.id, params.id),
      eq(contentCyclePosts.cycleId, gate.cycleId),
      eq(contentCyclePosts.clientId, session.clientId),
    ));

  const gen = await startPostGeneration(session.clientId, gate.cycleId, params.id, instruction, today);
  if ('blocked' in gen) return NextResponse.json({ mode: 'blocked', summary: gen.message });
  if ('readOnly' in gen) return NextResponse.json({ error: 'read_only' }, { status: 403 });
  if ('error' in gen) return NextResponse.json({ error: gen.error }, { status: 503 });
  return NextResponse.json({ mode: 'pending', summary: 'Thanks — we’re writing it now.', jobId: gen.jobId });
}
