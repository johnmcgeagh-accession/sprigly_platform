/**
 * client-health.ts — the read behind the adoption / divergence panel.
 *
 * Four queries, no join between them, assembled in memory and handed to the pure scorer in
 * `@sprigly/engine/caption-overlap`. Lives in admin because admin is the only surface that asks:
 * the app never shows a client their own adoption rate, and the worker has no reason to compute
 * it. The moment a second consumer appears this belongs in @sprigly/db beside `ai-change-usage`.
 *
 * ── COMPUTED ON READ, NOT MATERIALISED ──────────────────────────────────────────────────────
 *
 * Measured on Ivy T, the largest real client: ten trawled months, 275 published captions, 80
 * planned posts carrying 153 distinct Sprigly variants — 42,075 comparisons for the whole
 * history. That scores in 69ms of CPU. The client page needs ONE month, which is 4.4ms.
 *
 * The four queries took 493ms, but that number is my laptop reaching Railway across the
 * internet in two round trips; it is latency, not database work, and it is the same latency
 * every other query on this page already pays. A materialised table would not remove it — the
 * table would have to be read too.
 *
 * So the trade is 69ms of CPU on the trend page (4.4ms on the client page) against a refresh
 * trigger on four write paths: the monthly trawl, every caption save, every instructed reshape,
 * every plan regen. Four places to forget, and forgetting any of them leaves the operator
 * reading a stale number that looks current — the one failure this measure cannot afford, since
 * its whole purpose is to be believed. On-read wins, and it is not close.
 *
 * Headroom: both factors are bounded by how much a person can post and how much we can plan. A
 * client posting daily for three years against a 600-variant pool is ~40× this — under 3s for a
 * full history, still under 200ms for the one month the client page renders. If it ever stops
 * being true, the CLI that produced these numbers is `pnpm --filter @sprigly/worker
 * client-health-measure <slug>` and it is checked in.
 *
 * The cache below is therefore a de-duplicator, not a performance strategy: the client page and
 * its trend table both ask for the same client within one request, and React's `cache` collapses
 * that to one round of queries per render. It does not survive the request, so the number an
 * operator reads is always current.
 */
import { cache } from 'react';
import { db, igPosts, contentCyclePosts, postEdits, planActivity } from '@sprigly/db';
import { and, eq, isNull, inArray, asc } from 'drizzle-orm';
import {
  buildPool,
  monthHealth,
  type MonthHealth,
  type PublishedCaption,
  type SpriglyCaptionChain,
} from '@sprigly/engine/caption-overlap';

/** The shape `ig_posts.posts[]` holds — five keys, and never a post id. See caption-overlap.ts. */
interface TrawledPost {
  timestamp?: unknown;
  caption?:   unknown;
}

export interface ClientHealth {
  clientId: string;
  channel:  string;
  /** Newest month first. Every month with an `ig_posts` row, measured or honestly empty. */
  months:   MonthHealth[];
  /** Planned posts read into the pool, and how many yielded no Sprigly text at all. */
  poolSize: number;
  poolWithoutSpriglyText: number;
}

/**
 * Every version of every planned caption that Sprigly wrote, for one client + channel.
 *
 * The three sources and the reason each is or is not ours are documented on
 * `SpriglyCaptionChain`. This function's only job is to fetch them and preserve that ordering:
 * baseline first, reshapes in the order they happened, the live caption last and only when the
 * client has never typed into it.
 */
async function loadChains(clientId: string, channel: string): Promise<SpriglyCaptionChain[]> {
  const posts = await db
    .select({
      id:            contentCyclePosts.id,
      scheduledDate: contentCyclePosts.scheduledDate,
      caption:       contentCyclePosts.caption,
      sourceMeta:    contentCyclePosts.sourceMeta,
    })
    .from(contentCyclePosts)
    .where(and(
      eq(contentCyclePosts.clientId, clientId),
      eq(contentCyclePosts.channel, channel),
      isNull(contentCyclePosts.deletedAt),
    ));

  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);

  // Instructed reshapes — ours, and the refinement's whole point. `passed` only: a reshape that
  // failed validation never reached the client's screen, so its text was never a caption of ours.
  const reshapeRows = await db
    .select({ postId: postEdits.postId, captionAfter: postEdits.captionAfter, createdAt: postEdits.createdAt })
    .from(postEdits)
    .where(and(inArray(postEdits.postId, ids), eq(postEdits.passed, true)))
    .orderBy(asc(postEdits.createdAt));

  const reshapesByPost = new Map<string, string[]>();
  for (const r of reshapeRows) {
    const text = (r.captionAfter ?? '').trim();
    if (!text) continue;
    const list = reshapesByPost.get(r.postId) ?? [];
    list.push(text);
    reshapesByPost.set(r.postId, list);
  }

  // Posts the client has typed into. `origin = 'user'` on a caption_saved is her own hand —
  // every write path in app/ is behind a magic-link session (`app/src/lib/activity.ts`), so this
  // is a fact about the routing, not a guess about the person. `actor` is deliberately NOT used
  // to narrow it: that column is null on every row written before migration 0090, which is most
  // of the history, and treating unattributed as "not her" would put her words back in our pool.
  const typedRows = await db
    .select({ postId: planActivity.postId })
    .from(planActivity)
    .where(and(
      eq(planActivity.clientId, clientId),
      eq(planActivity.action, 'caption_saved'),
      eq(planActivity.origin, 'user'),
    ));
  const typedOver = new Set(typedRows.map((r) => r.postId).filter((id): id is string => !!id));

  return posts.map((p) => {
    const variants: string[] = [];
    const baseline = (p.sourceMeta as { original?: { caption?: unknown } } | null)?.original?.caption;
    if (typeof baseline === 'string' && baseline.trim()) variants.push(baseline);
    for (const r of reshapesByPost.get(p.id) ?? []) variants.push(r);
    const live = (p.caption ?? '').trim();
    if (live && !typedOver.has(p.id)) variants.push(live);
    return { postId: p.id, scheduledDate: p.scheduledDate, variants };
  });
}

/**
 * Every trawled month for one client + channel, scored.
 *
 * Months are keyed on the `ig_posts.month` column rather than on each post's own timestamp,
 * because that column IS the trawl's unit of work — a month with no row was never trawled, which
 * is the distinction `not_trawled` exists to carry. Posts whose timestamp falls outside their
 * row's month are dropped rather than counted in the wrong bucket; on Ivy T's ten months there
 * are none, and dropping is the behaviour that stays honest if the trawl ever changes.
 */
export const getClientHealth = cache(async (clientId: string, channel: string): Promise<ClientHealth> => {
  const [rows, chains] = await Promise.all([
    db
      .select({ month: igPosts.month, posts: igPosts.posts })
      .from(igPosts)
      .where(and(eq(igPosts.clientId, clientId), eq(igPosts.channel, channel))),
    loadChains(clientId, channel),
  ]);

  // ONE pool for every month — see `buildPool`. Ten months against a re-tokenised pool is ten
  // times the work and the same answer.
  const pool = buildPool(chains);

  const months = rows
    .map((row) => {
      const published: PublishedCaption[] = (row.posts as TrawledPost[] | null ?? [])
        .filter((p) => typeof p.timestamp === 'string' && (p.timestamp as string).startsWith(row.month))
        .map((p) => ({ timestamp: p.timestamp as string, caption: typeof p.caption === 'string' ? p.caption : null }));
      return monthHealth(row.month, published, pool);
    })
    .sort((a, b) => b.month.localeCompare(a.month));

  return {
    clientId,
    channel,
    months,
    poolSize: chains.length,
    poolWithoutSpriglyText: chains.filter((c) => c.variants.length === 0).length,
  };
});

/** The month the panel leads with, and the last complete one it shows beside it.
 *
 *  `current` is the calendar month the operator is standing in. It is PARTIAL by definition —
 *  the trawl runs monthly and lands after the month closes — so on the 3rd it is either absent
 *  or a single post reading "0 of 1". Neither is wrong and neither is useful on its own, which
 *  is why `latestMeasured` (the newest month other than this one that has a real answer) comes
 *  back alongside rather than instead. */
export function panelMonths(health: ClientHealth, currentMonth: string): {
  current:        MonthHealth;
  latestMeasured: MonthHealth | null;
} {
  const current = health.months.find((m) => m.month === currentMonth)
    ?? ({ state: 'not_trawled', month: currentMonth } as MonthHealth);
  const latestMeasured = health.months.find((m) => m.state === 'measured' && m.month !== currentMonth) ?? null;
  return { current, latestMeasured };
}
