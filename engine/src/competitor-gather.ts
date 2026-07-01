/**
 * competitor-gather.ts — deterministic gather phase for competitor analysis.
 *
 * Reads competitor handles from client_planning_config, fetches Instagram
 * posts via Apify (batched 3-concurrent), scores each post, builds per-account
 * stats and a cross-account benchmark table, then writes the result to
 * competitor_gather_cache.
 *
 * NO LLM call. NO strategic analysis. This is pure scrape + arithmetic.
 *
 * Staleness: per-handle check against the existing cache row. Handles whose
 * fetchedAt is < 30 days old are skipped (no Apify call). Stale or absent
 * handles are re-fetched. This means a re-run only fetches what has aged out.
 *
 * Account guard: WARN+SKIP (not throw). A competitor going private or being
 * renamed must not fail the whole gather run — continue with remaining handles.
 *
 * Called from:
 *   - competitor-gather-cli.ts (on-demand CLI)
 *   - Stage 3: BullMQ job (monthly schedule + ops panel trigger)
 */

import { eq, and } from 'drizzle-orm';
import { db as _db, clientPlanningConfig, competitorGatherCache } from '@sprigly/db';
import type {
  CompetitorAccountCache,
  CompetitorAccountStats,
  CompetitorBenchmarkRow,
  CompetitorFormatBreakdown,
  CompetitorGatherData,
  CompetitorTop5Post,
  ScoredIgPost,
} from '@sprigly/engine';
import type { Logger } from 'pino';
import { fetchApifyPostsForHandle, classifyApifyError, type RawApifyPost } from './apify-ig-fetch.js';

type Db = typeof _db;

// ── Constants ─────────────────────────────────────────────────────────────────

const STALE_DAYS          = 30;
const COMPETITOR_LIMIT    = 50;  // posts per account
const GATHER_CONCURRENCY  = 3;   // max parallel Apify calls
export const MAX_COMPETITORS = 5; // Apify-runway cap — scrape only the first 5 handles

// ── Scoring ───────────────────────────────────────────────────────────────────

const ctaRe     = /link in bio|shop now|comment below|tap the link|swipe up|click here|buy now|order now|shop the|get yours|link in story|dm us|message us|book now|sign up|shop link|available now/i;
const emojiRe   = /\p{Emoji_Presentation}/gu;
const hashtagRe = /#\w+/g;

function normalizeType(apifyType: string | undefined): string {
  switch ((apifyType ?? '').toLowerCase()) {
    case 'video':   return 'Reel';
    case 'sidecar': return 'Carousel';
    case 'image':   return 'Static';
    default:        return apifyType ?? 'Unknown';
  }
}

function captionSnippet(caption: string | undefined, maxWords = 15): string {
  if (!caption) return '';
  const words = caption.trim().split(/\s+/);
  if (words.length <= maxWords) return caption.trim();
  return words.slice(0, maxWords).join(' ') + '…';
}

function scorePost(p: RawApifyPost): ScoredIgPost {
  const likes    = p.likesCount    as number;
  const comments = p.commentsCount as number;
  const views    = typeof p.videoViewCount === 'number' && p.videoViewCount >= 0
    ? p.videoViewCount
    : 0;
  const caption  = p.caption ?? '';
  const words    = caption.trim().split(/\s+/).filter(Boolean);

  const base = {
    timestamp:       p.timestamp ?? '',
    type:            normalizeType(p.type),
    likes,
    comments,
    views,
    engagementScore: likes + comments * 3,
    wordCount:       words.length,
    hasQuestion:     caption.includes('?'),
    hasCta:          ctaRe.test(caption),
    emojiCount:      (caption.match(emojiRe) ?? []).length,
    hashtagCount:    (caption.match(hashtagRe) ?? []).length,
  };
  return caption ? { ...base, caption } : base;
}

// ── Per-account stats ─────────────────────────────────────────────────────────

function buildAccountStats(handle: string, posts: ScoredIgPost[]): CompetitorAccountStats {
  if (posts.length === 0) {
    return {
      handle, postCount: 0, avgEngagement: 0, topPostScore: 0,
      postsPerWeek: 0, dateRange: { oldest: '', newest: '' },
      formatBreakdown: [], top5Posts: [],
    };
  }

  const sorted   = [...posts].sort((a, b) => b.engagementScore - a.engagementScore);
  const totalEng = posts.reduce((s, p) => s + p.engagementScore, 0);

  const timestamps = posts.map((p) => p.timestamp).filter(Boolean).sort();
  const oldest     = timestamps[0]  ?? '';
  const newest     = timestamps[timestamps.length - 1] ?? '';
  const daySpan    = oldest && newest && oldest !== newest
    ? (new Date(newest).getTime() - new Date(oldest).getTime()) / 86_400_000
    : 7;
  const postsPerWeek = Math.round((posts.length / daySpan) * 7 * 10) / 10;

  // Format breakdown
  const byType = new Map<string, ScoredIgPost[]>();
  for (const post of posts) {
    const arr = byType.get(post.type) ?? [];
    arr.push(post);
    byType.set(post.type, arr);
  }
  const formatBreakdown: CompetitorFormatBreakdown[] = [...byType.entries()]
    .map(([type, typePosts]) => ({
      type,
      count:         typePosts.length,
      avgEngagement: Math.round(typePosts.reduce((s, p) => s + p.engagementScore, 0) / typePosts.length),
      topScore:      Math.max(...typePosts.map((p) => p.engagementScore)),
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  const top5Posts: CompetitorTop5Post[] = sorted.slice(0, 5).map((p) => ({
    timestamp:       p.timestamp,
    type:            p.type,
    engagementScore: p.engagementScore,
    captionSnippet:  captionSnippet(p.caption, 15),
  }));

  return {
    handle,
    postCount:   posts.length,
    avgEngagement: Math.round(totalEng / posts.length),
    topPostScore:  sorted[0]!.engagementScore,
    postsPerWeek,
    dateRange:     { oldest, newest },
    formatBreakdown,
    top5Posts,
  };
}

// ── Benchmark table ───────────────────────────────────────────────────────────

function buildBenchmark(accounts: CompetitorAccountCache[]): CompetitorBenchmarkRow[] {
  return accounts
    .filter((a) => a.posts.length > 0)
    .map((a) => ({
      handle:        a.handle,
      avgEngagement: a.stats.avgEngagement,
      topPostScore:  a.stats.topPostScore,
      bestType:      a.stats.formatBreakdown[0]?.type ?? 'Unknown',
      postsPerWeek:  a.stats.postsPerWeek,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);
}

// ── Concurrency batching ──────────────────────────────────────────────────────

async function runBatched<T>(
  items:       T[],
  concurrency: number,
  fn:          (item: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += concurrency) {
    await Promise.all(items.slice(i, i + concurrency).map(fn));
  }
}

// ── Staleness check ───────────────────────────────────────────────────────────

function isHandleFresh(existing: CompetitorGatherData | null, handle: string): boolean {
  if (!existing) return false;
  const acc = existing.accounts.find((a) => a.handle === handle);
  if (!acc) return false;
  const fetchedAt = new Date(acc.fetchedAt).getTime();
  return fetchedAt > Date.now() - STALE_DAYS * 86_400_000;
}

// ── Gather result ─────────────────────────────────────────────────────────────

export interface GatherResult {
  accountsGathered:     number;
  accountsSkippedFresh: number;
  accountsFailed:       number;
  quotaExhausted:       boolean;   // Apify returned 402/429 during the run
}

// ── Main gather function ──────────────────────────────────────────────────────

export interface CompetitorGatherDeps {
  db:          Db;
  apifyApiKey: string | undefined;
  logger:      Logger;
}

export async function gatherCompetitorData(
  clientId: string,
  channel:  string,
  deps:     CompetitorGatherDeps,
): Promise<GatherResult> {
  const { db, apifyApiKey, logger } = deps;
  const logCtx = { clientId, channel };

  // 1. Load competitors list from planning config
  const configRows = await db
    .select({ competitors: clientPlanningConfig.competitors })
    .from(clientPlanningConfig)
    .where(and(eq(clientPlanningConfig.clientId, clientId), eq(clientPlanningConfig.channel, channel)))
    .limit(1);

  const configured = (configRows[0]?.competitors ?? []) as string[];
  if (configured.length === 0) {
    logger.warn(logCtx, 'competitor-gather: no competitors configured in client_planning_config — skipping');
    return { accountsGathered: 0, accountsSkippedFresh: 0, accountsFailed: 0, quotaExhausted: false };
  }
  // Runway cap: only ever scrape the first MAX_COMPETITORS. An over-cap list is
  // flagged (not silently truncated) so it can be trimmed in admin.
  const competitors = configured.slice(0, MAX_COMPETITORS);
  if (configured.length > MAX_COMPETITORS) {
    logger.warn({ ...logCtx, configured: configured.length, cap: MAX_COMPETITORS, dropped: configured.slice(MAX_COMPETITORS) },
      `competitor-gather: ${configured.length} competitors configured but capped at ${MAX_COMPETITORS} — trim the list in admin`);
  }
  logger.info({ ...logCtx, count: competitors.length, competitors }, 'competitor-gather: starting gather');

  // 2. Load existing cache (for per-handle staleness and merging)
  const cacheRows = await db
    .select()
    .from(competitorGatherCache)
    .where(and(eq(competitorGatherCache.clientId, clientId), eq(competitorGatherCache.channel, channel)))
    .limit(1);

  const existingCache = (cacheRows[0]?.rawData ?? null) as CompetitorGatherData | null;
  const accountMap    = new Map<string, CompetitorAccountCache>(
    (existingCache?.accounts ?? []).map((a) => [a.handle, a]),
  );

  if (!apifyApiKey) {
    logger.warn(logCtx, 'competitor-gather: APIFY_API_KEY not set — skipping all Apify calls; writing cache from existing data only');
  }

  let accountsGathered     = 0;
  let accountsSkippedFresh = 0;
  let accountsFailed       = 0;
  let quotaExhausted       = false;   // set when Apify returns 402/429 for any handle

  // 3. Batch fetch (3-concurrent)
  await runBatched(competitors, GATHER_CONCURRENCY, async (handle) => {
    const handleCtx = { ...logCtx, handle };

    // Per-handle staleness check
    if (isHandleFresh(existingCache, handle)) {
      logger.info(handleCtx, 'competitor-gather: handle is fresh (<30d) — using cached data');
      accountsSkippedFresh++;
      return;
    }

    if (!apifyApiKey) {
      // No API key and handle is stale — skip silently (already warned above)
      accountsFailed++;
      return;
    }

    // Fetch
    let fetchResult: Awaited<ReturnType<typeof fetchApifyPostsForHandle>>;
    try {
      fetchResult = await fetchApifyPostsForHandle(handle, COMPETITOR_LIMIT, apifyApiKey, logger, handleCtx);
    } catch (err) {
      // Branch on 402/429 so credit exhaustion is surfaced distinctly instead of
      // hiding inside the generic accountsFailed counter (every remaining handle
      // would otherwise 402 and look like a private/renamed account).
      const kind = classifyApifyError(err);
      if (kind === 'quota_exhausted') {
        quotaExhausted = true;
        logger.error({ ...handleCtx, err: String(err) },
          'competitor-gather: Apify QUOTA EXHAUSTED (402/429) — credits spent; remaining handles will also fail');
      } else {
        logger.warn({ ...handleCtx, err: String(err), kind: kind ?? 'other' },
          'competitor-gather: Apify fetch failed — skipping this handle (non-fatal)');
      }
      accountsFailed++;
      return;
    }

    const { ownedPosts, posts, droppedForeignCount, skippedHiddenCount } = fetchResult;

    if (ownedPosts.length === 0) {
      // Account is private, renamed, or genuinely unreachable
      logger.warn({ ...handleCtx, distinctOtherOwners: fetchResult.distinctOtherOwners },
        'competitor-gather: zero owned posts — account may be private or handle renamed; skipping');
      accountsFailed++;
      return;
    }

    if (droppedForeignCount > 0) {
      logger.info({ ...handleCtx, droppedCount: droppedForeignCount },
        'competitor-gather: dropped foreign-owner (tagged/mention) posts — normal actor behaviour');
    }
    if (skippedHiddenCount > 0) {
      logger.info({ ...handleCtx, skipped: skippedHiddenCount },
        'competitor-gather: skipped posts with hidden or negative like/comment counts');
    }

    if (posts.length === 0) {
      logger.warn({ ...handleCtx, ownedCount: ownedPosts.length, skippedHidden: skippedHiddenCount },
        'competitor-gather: all owned posts had hidden engagement counts — skipping this handle');
      accountsFailed++;
      return;
    }

    // Score and build stats
    const scoredPosts = posts.map(scorePost);
    const stats       = buildAccountStats(handle, scoredPosts);

    accountMap.set(handle, {
      handle,
      fetchedAt: new Date().toISOString(),
      posts:     scoredPosts,
      stats,
    });

    accountsGathered++;
    logger.info(
      { ...handleCtx, postCount: scoredPosts.length, avgEngagement: stats.avgEngagement, topPost: stats.topPostScore },
      'competitor-gather: handle gathered and scored',
    );
  });

  // 4. Assemble result (preserve order from competitors list)
  const accounts = competitors
    .map((h) => accountMap.get(h))
    .filter((a): a is CompetitorAccountCache => Boolean(a));

  const benchmark: CompetitorBenchmarkRow[] = buildBenchmark(accounts);

  const gatherData: CompetitorGatherData = {
    accounts,
    benchmark,
    gatheredAt: new Date().toISOString(),
    quotaExhausted,
  };

  // 5. Upsert to DB
  const now = new Date();
  if (cacheRows[0]) {
    await db
      .update(competitorGatherCache)
      .set({ rawData: gatherData as unknown as Record<string, unknown>, gatheredAt: now, updatedAt: now })
      .where(and(eq(competitorGatherCache.clientId, clientId), eq(competitorGatherCache.channel, channel)));
  } else {
    await db
      .insert(competitorGatherCache)
      .values({ clientId, channel, gatheredAt: now, rawData: gatherData as unknown as Record<string, unknown> });
  }

  logger.info({ ...logCtx, accountsGathered, accountsSkippedFresh, accountsFailed, quotaExhausted, total: competitors.length },
    'competitor-gather: complete');

  return { accountsGathered, accountsSkippedFresh, accountsFailed, quotaExhausted };
}
