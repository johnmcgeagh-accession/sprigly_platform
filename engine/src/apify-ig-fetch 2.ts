/**
 * apify-ig-fetch.ts — shared Apify instagram-scraper fetch helper.
 *
 * Called by both the client trawl (ig-producer.ts) and the competitor
 * gather worker (competitor-gather.ts). Does:
 *   - Apify HTTP call (apify~instagram-scraper, run-sync-get-dataset-items)
 *   - ownerUsername filter (drops tagged/mention posts from other accounts)
 *   - hidden-likes filter (drops posts where likesCount or commentsCount
 *     is -1 or null — Instagram accounts that hide engagement counts)
 *
 * Does NOT apply a month filter — that is client-trawl-specific.
 * Does NOT write to Drive or DB — callers own their output.
 * Does NOT decide what to do when zero posts survive — callers own that
 * decision (client trawl throws; competitor gather warns and skips).
 *
 * Both ownedPosts (after owner filter, before hidden filter) and posts
 * (after both filters) are returned so callers can apply the right guard.
 */

import type { Logger } from 'pino';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RawApifyPost {
  caption?:        string;
  timestamp?:      string;
  likesCount?:     number | null;
  commentsCount?:  number | null;
  videoViewCount?: number | null;
  type?:           string;           // 'Image' | 'Video' | 'Sidecar'
  ownerUsername?:  string;
}

export interface FetchApifyPostsResult {
  rawCount:            number;
  ownedPosts:          RawApifyPost[];  // after ownerUsername filter, before hidden filter
  posts:               RawApifyPost[];  // after both filters (ownedPosts ∩ visible counts)
  droppedForeignCount: number;
  skippedHiddenCount:  number;
  distinctOtherOwners: string[];        // non-owned usernames; helps callers build error messages
}

const APIFY_TIMEOUT_MS = 120_000;

// ── Fetch helper ──────────────────────────────────────────────────────────────

export async function fetchApifyPostsForHandle(
  handle:       string,
  resultsLimit: number,
  apifyApiKey:  string,
  logger:       Logger,
  logCtx:       Record<string, unknown>,
): Promise<FetchApifyPostsResult> {
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), APIFY_TIMEOUT_MS);

  let rawPosts: RawApifyPost[];
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${apifyApiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          directUrls:    [`https://www.instagram.com/${handle}/`],
          resultsType:   'posts',
          resultsLimit,
          addParentData: false,
        }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const body = await res.json() as unknown;
    if (!Array.isArray(body)) throw new Error('Apify response is not an array');
    rawPosts = body as RawApifyPost[];
    logger.info({
      ...logCtx,
      handle,
      rawCount:   rawPosts.length,
      firstOwner: rawPosts[0]?.ownerUsername,
      firstUrl:   (rawPosts[0] as Record<string, unknown>)?.['url'],
    }, 'apify-ig-fetch: raw response (pre-filter)');
  } catch (err) {
    const label = (err as { name?: string }).name === 'AbortError'
      ? `timed out after ${APIFY_TIMEOUT_MS / 1000}s`
      : String(err);
    throw new Error(`apify-ig-fetch: Apify call failed for handle "${handle}": ${label}`);
  } finally {
    clearTimeout(abortTimer);
  }

  const rawCount = rawPosts.length;

  // ── ownerUsername filter ──────────────────────────────────────────────────
  const ownedPosts = rawPosts.filter(
    (p) => p.ownerUsername === undefined || p.ownerUsername.toLowerCase() === handle.toLowerCase(),
  );
  const droppedForeignCount = rawCount - ownedPosts.length;
  const distinctOtherOwners = droppedForeignCount > 0
    ? [...new Set(
        rawPosts
          .filter((p) => p.ownerUsername?.toLowerCase() !== handle.toLowerCase())
          .map((p) => p.ownerUsername)
          .filter((u): u is string => Boolean(u)),
      )]
    : [];

  // ── hidden-likes filter ───────────────────────────────────────────────────
  let skippedHiddenCount = 0;
  const posts = ownedPosts.filter((p) => {
    const likesOk    = typeof p.likesCount    === 'number' && p.likesCount    >= 0;
    const commentsOk = typeof p.commentsCount === 'number' && p.commentsCount >= 0;
    if (!likesOk || !commentsOk) { skippedHiddenCount++; return false; }
    return true;
  });

  return { rawCount, ownedPosts, posts, droppedForeignCount, skippedHiddenCount, distinctOtherOwners };
}
