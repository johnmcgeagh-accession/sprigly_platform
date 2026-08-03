/**
 * ideas.ts (server) — reading the client's durable inputs, and what became of each.
 *
 * The derivation lives in `@/lib/ideas` and is pure, because the panel renders it and the panel
 * must not import the database. This file is the read: three columns of `plan_inputs`, the cycle
 * that consumed each one, and the post a beat traced itself back to.
 *
 * ── Deliberately WIDER than listActiveNotes ──────────────────────────────────────────
 *
 * `listActiveNotes` filters to type='note' AND status='active' because its caller — the agent's
 * own context — only wants notes that are still live. Ideas wants the opposite: everything the
 * client has ever given us, including what was used and what was set aside, because the whole
 * point of the view is answering "what happened to the thing I said?". A list that silently drops
 * the used ones would answer it wrong and look right.
 *
 * ── The two links, and why both are nullable ─────────────────────────────────────────
 *
 * `used_in_cycle_id` records WHICH month consumed the input. `beat_meta.sourceRef` records which
 * BEAT it became, written by the draft assembler when an allocation carries a candidate
 * (draft-assembly.ts). They are written at different moments by different code, so an input can
 * have either, both, or neither, and the panel is built to show whatever is there. In UAT today:
 * 14 inputs carry a cycle, 6 posts carry a sourceRef.
 *
 * Nothing here writes.
 */
import { db, planInputs, contentCycles, contentCyclePosts } from '@sprigly/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { nextMonth } from '@/lib/cycle-nav';
import { monthLabel } from './cycle-state';
import { ideaState, postHeadline, sortIdeas, type IdeaView } from '@/lib/ideas';

/**
 * Every durable input this client has given us, ordered for reading (live first).
 *
 * The post join is LEFT and on `beat_meta->>'sourceRef'`, which is a text comparison against a
 * uuid cast — the only way to match, because the reference is stored inside JSON rather than as
 * a foreign key. It is also filtered to live posts: a beat whose post was deleted is not a
 * tap-through, and offering one would 404.
 */
export async function listIdeas(clientId: string): Promise<IdeaView[]> {
  const rows = await db
    .select({
      id: planInputs.id,
      content: planInputs.content,
      type: planInputs.type,
      status: planInputs.status,
      lifecycle: planInputs.lifecycle,
      createdAt: planInputs.createdAt,
      usedCycleMonth: contentCycles.cycleMonth,
      postId: contentCyclePosts.id,
      postCaption: contentCyclePosts.caption,
    })
    .from(planInputs)
    .leftJoin(contentCycles, eq(contentCycles.id, planInputs.usedInCycleId))
    .leftJoin(
      contentCyclePosts,
      and(
        sql`${contentCyclePosts.beatMeta}->>'sourceRef' = ${planInputs.id}::text`,
        eq(contentCyclePosts.clientId, clientId),
        isNull(contentCyclePosts.deletedAt),
      ),
    )
    .where(eq(planInputs.clientId, clientId));

  return sortIdeas(rows.map((r) => {
    const state = ideaState(r);
    return {
      id: r.id,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
      state,
      // The cycle sits one month behind the month it displays (cycle-nav.ts), so a
      // cycle_month of 2026-07 is the August plan. Reading the raw column here would
      // tell the client their July idea was used in July, a month before it ran.
      usedInMonth: r.usedCycleMonth ? monthLabel(nextMonth(r.usedCycleMonth)) : null,
      // A post with no caption yet has no headline, and the row then shows the state
      // alone rather than a tap-through labelled "Untitled".
      postId: r.postId ?? null,
      postTitle: postHeadline(r.postCaption),
    };
  }));
}
