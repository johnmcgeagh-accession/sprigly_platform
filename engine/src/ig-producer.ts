/**
 * ig-producer.ts — fetch last-month Instagram posts for a client and upsert them
 * into the ig_posts DB table, keyed (client_id, channel, month). Re-homed off
 * Google Drive (previously instagram-posts-YYYY-MM.json in the client's folder).
 *
 * The row written here is the input consumed by lean-line.ts/fetchTopPosts and by
 * planning's loadHistoricPosts. All use the same igPostSchema from lean-line.ts —
 * one contract, all ends.
 *
 * APIFY_API_KEY is read by the CLI entry point (ig-trawl.ts) and passed in.
 * It is absent from the main worker env intentionally — the worker never calls Apify.
 *
 * Apify call is delegated to the shared fetchApifyPostsForHandle helper in
 * apify-ig-fetch.ts, which is also used by the competitor gather worker.
 */

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db as _db, clientChannels, contentCycles, igPosts } from '@sprigly/db';
import { type EncryptionProvider } from '@sprigly/oauth-tokens';
import type { Logger } from 'pino';
import { igPostSchema, mapApifyMediaType, tallyUnmappedMediaTypes } from './lean-line.js';
import { fetchApifyPostsForHandle, classifyApifyError } from './apify-ig-fetch.js';

type Db = typeof _db;

// DEFAULT results limit — must exceed the number of posts the account publishes per month.
// At 50, an account posting > 50 times per month will miss posts near the start of the
// window. Note this is the count of the account's most recent posts, so a mid-month run
// spends part of the window on the CURRENT month and reaches proportionally less far back:
// ivy-t's prod 2026-06 row holds 16 posts against the 28 she actually published, because a
// 21 July trawl at 50 only reached back to early June.
//
// Now a parameter (`resultsLimit` on IgProducerParams) rather than a ceiling. Every existing
// caller omits it and gets 50; the deep-trawl CLI passes its own.
export const DEFAULT_RESULTS_LIMIT = 50;

const igPostsArraySchema = z.array(igPostSchema);

export interface IgProducerParams {
  clientId:      string;
  channel:       string;
  month:         string;              // YYYY-MM
  handle:        string | undefined;  // instagram_handle from client_channels DB column
  db:            Db;                   // posts are upserted into ig_posts (no Drive)
  apifyApiKey:   string | undefined;
  logger:        Logger;
  resultsLimit?: number;               // how deep to reach; omit for DEFAULT_RESULTS_LIMIT
  timeoutMs?:    number;               // rides with depth — the actor is slower the deeper it goes
}

// ── London-timezone month filter ──────────────────────────────────────────────

const londonFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year:     'numeric',
  month:    '2-digit',
});

function inTargetMonth(timestamp: string | undefined, month: string): boolean {
  if (!timestamp) return false;
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return false;
    const parts = londonFmt.formatToParts(d);
    const y = parts.find((p) => p.type === 'year')?.value  ?? '';
    const m = parts.find((p) => p.type === 'month')?.value ?? '';
    return `${y}-${m}` === month;
  } catch {
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

/** Distinct IG-input outcome, recorded on the cycle so the prepare panel can tell
 *  "never ran" from "ran empty" from "failed". 'quota_exhausted'/'bad_key'/'error'
 *  are produced in runIgTrawlJob from the thrown Apify error, not here. */
export type IgTrawlStatus =
  | 'ok' | 'no_key' | 'no_handle' | 'empty_month' | 'account_mismatch'
  | 'quota_exhausted' | 'bad_key' | 'error';
export interface IgTrawlOutcome { status: IgTrawlStatus; detail?: string; postCount?: number }

export async function trawlInstagramPosts(params: IgProducerParams): Promise<IgTrawlOutcome> {
  const { clientId, channel, month, handle, db, apifyApiKey, logger, resultsLimit = DEFAULT_RESULTS_LIMIT, timeoutMs } = params;
  const logCtx = { clientId, channel, month };

  // ── Missing API key ───────────────────────────────────────────────────────
  if (!apifyApiKey) {
    logger.warn(logCtx, 'ig-trawl: APIFY_API_KEY not set — skipping; lean-line degrades to sales-only');
    return { status: 'no_key' };
  }

  // ── Missing handle (DB column absent) ────────────────────────────────────
  if (!handle) {
    logger.info(logCtx, 'ig-trawl: no instagram_handle — skipping');
    return { status: 'no_handle' };
  }

  // ── Fetch from Apify (shared helper) ─────────────────────────────────────
  logger.info({ ...logCtx, handle, resultsLimit }, 'ig-trawl: calling Apify');

  const {
    rawCount,
    ownedPosts,
    posts:        countOk,
    droppedForeignCount,
    skippedHiddenCount,
    distinctOtherOwners,
  } = await fetchApifyPostsForHandle(handle, resultsLimit, apifyApiKey, logger, logCtx, timeoutMs === undefined ? {} : { timeoutMs });

  // ── Account guard ─────────────────────────────────────────────────────────
  // The actor returns a mix: the account's own posts plus posts that tag/mention
  // the handle. Keep only owned posts; drop the rest as expected noise.
  // Throw only when ZERO posts match — that's a genuinely wrong handle.
  if (droppedForeignCount > 0) {
    logger.info({ ...logCtx, handle, droppedCount: droppedForeignCount },
      'ig-trawl: dropped tagged/mention posts (foreign owner) — normal actor behaviour');
  }
  if (ownedPosts.length === 0) {
    // Record + return (not throw): a wrong handle is deterministic — retrying 5× is
    // futile, and the prepare panel should show "handle mismatch", not a failed job.
    const detail = `expected "${handle}", found owners: ${distinctOtherOwners.join(', ') || '(none)'}`;
    logger.warn({ ...logCtx, handle, distinctOtherOwners }, `ig-trawl: account mismatch — ${detail}`);
    return { status: 'account_mismatch', detail };
  }

  // ── Coverage visibility ───────────────────────────────────────────────────
  // Sort ISO strings alphabetically = chronologically.
  const sortedTs = ownedPosts
    .map((p) => p.timestamp)
    .filter((t): t is string => typeof t === 'string')
    .sort();
  logger.info({
    ...logCtx,
    handle,
    rawCount,
    ownedCount:      ownedPosts.length,
    oldestTimestamp: sortedTs[0] ?? '(none)',
    monthStart:      `${month}-01`,
    resultsLimit,
  }, 'ig-trawl: coverage check — if oldestTimestamp > monthStart, raise resultsLimit');

  // ── Log hidden skips (done in helper; log here for ig-trawl context) ─────
  if (skippedHiddenCount > 0) {
    logger.info({ ...logCtx, handle, skipped: skippedHiddenCount },
      'ig-trawl: skipped posts with hidden or negative like/comment counts');
  }

  // ── Month filter (London wall-clock time) ─────────────────────────────────
  const monthPosts = countOk.filter((p) => inTargetMonth(p.timestamp, month));

  if (monthPosts.length === 0) {
    logger.warn({ ...logCtx, handle, rawCount, ownedCount: ownedPosts.length, skippedHidden: skippedHiddenCount },
      'ig-trawl: no posts for target month after filtering — not writing file');
    return { status: 'empty_month', detail: `${ownedPosts.length} owned posts, none in ${month}` };
  }

  // ── Map to igPostSchema shape (mediaType from Apify `type`, omitted if unknown) ─
  const mapped = monthPosts.map((p) => {
    const mt = mapApifyMediaType(p.type);
    return {
      timestamp:     p.timestamp!,
      caption:       p.caption,
      likesCount:    p.likesCount  as number,
      commentsCount: p.commentsCount as number,
      ...(mt ? { mediaType: mt } : {}),
    };
  });

  // ── An unmapped type is LOUD ──────────────────────────────────────────────
  // Omitting the key is the only thing we can do with a value we do not understand, but
  // doing it quietly is how the gap survived: an absent mediaType reads downstream as a
  // pre-mediaType row, so format derivation silently narrows to a subset and reports full
  // confidence. The raw value and its count go on the record here, at the moment of loss.
  const unmapped = tallyUnmappedMediaTypes(monthPosts.map((p) => p.type));
  const unmappedCount = Object.values(unmapped).reduce((s, n) => s + n, 0);
  if (unmappedCount > 0) {
    logger.warn({ ...logCtx, handle, unmappedTypes: unmapped, unmappedCount, ofPosts: monthPosts.length },
      'ig-trawl: UNMAPPED Apify media type — these posts are stored without a mediaType and are ' +
      'invisible to format derivation; add the raw value to mapApifyMediaType');
  }

  // ── Validate against shared schema ────────────────────────────────────────
  // Rejects floats, negatives, and missing fields that slipped past count filter.
  // Throws rather than writing a partial file.
  let validated: z.infer<typeof igPostsArraySchema>;
  try {
    validated = igPostsArraySchema.parse(mapped);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      const idx   = first?.path[0] ?? '?';
      throw new Error(`ig-trawl: schema validation failed at item ${String(idx)}: ${err.message}`);
    }
    throw err;
  }

  logger.info({ ...logCtx, handle, postCount: validated.length },
    'ig-trawl: posts validated for month');

  // ── Idempotent DB upsert (re-homed off Drive) ─────────────────────────────
  // Latest-wins per (client_id, channel, month) — a re-trawl of the same month
  // replaces the posts array in place, matching the old file-overwrite behaviour.
  const postsPayload = validated as unknown as Array<Record<string, unknown>>;
  await db
    .insert(igPosts)
    .values({ clientId, channel, month, posts: postsPayload })
    .onConflictDoUpdate({
      target: [igPosts.clientId, igPosts.channel, igPosts.month],
      set:    { posts: postsPayload, updatedAt: new Date() },
    });
  logger.info({ ...logCtx, handle, month, postCount: validated.length },
    'ig-trawl: upserted ig_posts row');

  return { status: 'ok', postCount: validated.length };
}

// ── Job-level runner (called by BullMQ consumer and CLI wrapper) ──────────────

export interface RunIgTrawlJobDeps {
  db:                 Db;
  encProvider:        EncryptionProvider;
  googleClientId:     string;
  googleClientSecret: string;
  apifyApiKey:        string | undefined;
  logger:             Logger;
}

export async function runIgTrawlJob(
  clientId:  string,
  channel:   string,
  dataMonth: string,
  deps:      RunIgTrawlJobDeps,
): Promise<void> {
  // IG posts are now stored in the ig_posts DB table, so the trawl no longer needs
  // Drive tokens or a drive_folder_id (deps.encProvider / googleClientId /
  // googleClientSecret are now unused here — kept on the deps type so callers are
  // unchanged). Only the instagram_handle is required, for the Apify fetch.
  const { db, apifyApiKey, logger } = deps;
  const logCtx = { clientId, channel, dataMonth };

  const chanRows = await db
    .select({ instagramHandle: clientChannels.instagramHandle })
    .from(clientChannels)
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)))
    .limit(1);

  const chanRow = chanRows[0];

  // Record the IG-input outcome on the cycle (best-effort) so the prepare panel can
  // distinguish never-ran / empty / failed. The cycle is keyed by (clientId, channel,
  // cycleMonth) and dataMonth == cycleMonth, so we resolve it without a cycleId.
  const recordIgStatus = async (status: string, detail?: string): Promise<void> => {
    try {
      await db.update(contentCycles)
        .set({ igInputStatus: status, igInputDetail: detail ?? null, igInputCheckedAt: new Date() })
        .where(and(
          eq(contentCycles.clientId, clientId),
          eq(contentCycles.channel, channel),
          eq(contentCycles.cycleMonth, dataMonth),
        ));
    } catch (err) {
      logger.warn({ ...logCtx, err: String(err) }, 'ig-trawl: could not record ig_input_status');
    }
  };

  try {
    const outcome = await trawlInstagramPosts({
      clientId, channel, month: dataMonth,
      handle: chanRow?.instagramHandle ?? undefined,
      db, apifyApiKey, logger,
    });
    await recordIgStatus(outcome.status, outcome.detail);
  } catch (err) {
    // Apify auth/quota failures are deterministic — record the distinct status and
    // DON'T rethrow (no point retrying 5×). Transient/unknown errors record 'error'
    // and rethrow so BullMQ can retry them.
    const apify = classifyApifyError(err);
    if (apify) {
      await recordIgStatus(apify, String((err as { message?: unknown })?.message ?? err).slice(0, 300));
      logger.error({ ...logCtx, status: apify }, `ig-trawl: Apify ${apify} — recorded, not retrying`);
      return;
    }
    await recordIgStatus('error', String((err as { message?: unknown })?.message ?? err).slice(0, 300));
    throw err;
  }
}
