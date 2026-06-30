/**
 * ig-producer.ts — fetch last-month Instagram posts for a client and write
 * instagram-posts-YYYY-MM.json to their Drive folder (app-owned, drive.file scope).
 *
 * The file produced here is the input consumed by lean-line.ts/fetchTopPosts.
 * Both use the same igPostSchema from lean-line.ts — one contract, both ends.
 *
 * APIFY_API_KEY is read by the CLI entry point (ig-trawl.ts) and passed in.
 * It is absent from the main worker env intentionally — the worker never calls Apify.
 *
 * Apify call is delegated to the shared fetchApifyPostsForHandle helper in
 * apify-ig-fetch.ts, which is also used by the competitor gather worker.
 */

import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db as _db, clientChannels } from '@sprigly/db';
import { DriveApiClient } from '@sprigly/sources';
import { getTokens, storeTokens, type EncryptionProvider } from '@sprigly/oauth-tokens';
import type { Logger } from 'pino';
import { igPostSchema } from './lean-line.js';
import { fetchApifyPostsForHandle } from './apify-ig-fetch.js';

type Db = typeof _db;

// Results limit — must exceed the number of posts the account publishes per month.
// At 50, an account posting > 50 times per month will miss posts near the start of
// the window. Raise if the coverage check shows oldestTimestamp > monthStart.
const APIFY_RESULTS_LIMIT = 50;

const igPostsArraySchema = z.array(igPostSchema);

export interface IgProducerParams {
  clientId:      string;
  channel:       string;
  month:         string;              // YYYY-MM
  handle:        string | undefined;  // instagram_handle from client_channels DB column
  driveFolderId: string;
  drive:         DriveApiClient;
  apifyApiKey:   string | undefined;
  logger:        Logger;
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

export async function trawlInstagramPosts(params: IgProducerParams): Promise<void> {
  const { clientId, channel, month, handle, driveFolderId, drive, apifyApiKey, logger } = params;
  const logCtx = { clientId, channel, month };

  // ── Missing API key ───────────────────────────────────────────────────────
  if (!apifyApiKey) {
    logger.warn(logCtx, 'ig-trawl: APIFY_API_KEY not set — skipping; lean-line degrades to sales-only');
    return;
  }

  // ── Missing handle (DB column absent) ────────────────────────────────────
  if (!handle) {
    logger.info(logCtx, 'ig-trawl: no instagram_handle — skipping');
    return;
  }

  // ── Fetch from Apify (shared helper) ─────────────────────────────────────
  logger.info({ ...logCtx, handle, resultsLimit: APIFY_RESULTS_LIMIT }, 'ig-trawl: calling Apify');

  const {
    rawCount,
    ownedPosts,
    posts:        countOk,
    droppedForeignCount,
    skippedHiddenCount,
    distinctOtherOwners,
  } = await fetchApifyPostsForHandle(handle, APIFY_RESULTS_LIMIT, apifyApiKey, logger, logCtx);

  // ── Account guard ─────────────────────────────────────────────────────────
  // The actor returns a mix: the account's own posts plus posts that tag/mention
  // the handle. Keep only owned posts; drop the rest as expected noise.
  // Throw only when ZERO posts match — that's a genuinely wrong handle.
  if (droppedForeignCount > 0) {
    logger.info({ ...logCtx, handle, droppedCount: droppedForeignCount },
      'ig-trawl: dropped tagged/mention posts (foreign owner) — normal actor behaviour');
  }
  if (ownedPosts.length === 0) {
    throw new Error(
      `ig-trawl: account mismatch — expected "${handle}", found owners: ${distinctOtherOwners.join(', ')}. ` +
      `Check instagram_handle in client_channels for this client.`,
    );
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
    resultsLimit:    APIFY_RESULTS_LIMIT,
  }, 'ig-trawl: coverage check — if oldestTimestamp > monthStart, raise APIFY_RESULTS_LIMIT');

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
    return;
  }

  // ── Map to igPostSchema shape ─────────────────────────────────────────────
  const mapped = monthPosts.map((p) => ({
    timestamp:     p.timestamp!,
    caption:       p.caption,
    likesCount:    p.likesCount  as number,
    commentsCount: p.commentsCount as number,
  }));

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

  // ── Idempotent Drive write ────────────────────────────────────────────────
  const filename    = `instagram-posts-${month}.json`;
  const content     = Buffer.from(JSON.stringify(validated, null, 2));
  const mimeType    = 'application/json';
  const folderFiles = await drive.listFiles(driveFolderId);
  const existing    = folderFiles.find((f) => f.name.toLowerCase() === filename.toLowerCase());

  if (existing) {
    await drive.updateFile(existing.id, mimeType, content);
    logger.info({ ...logCtx, handle, filename, fileId: existing.id, postCount: validated.length },
      'ig-trawl: updated existing Drive file (idempotent re-run)');
  } else {
    const fileId = await drive.createFile(driveFolderId, filename, mimeType, content);
    logger.info({ ...logCtx, handle, filename, fileId, postCount: validated.length },
      'ig-trawl: created Drive file');
  }
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
  const { db, encProvider, googleClientId, googleClientSecret, apifyApiKey, logger } = deps;
  const logCtx = { clientId, channel, dataMonth };

  const tokens = await getTokens(db, encProvider, clientId, 'drive');
  if (!tokens) throw new Error(`ig-trawl: no Drive tokens for client ${clientId}`);

  const chanRows = await db
    .select({
      driveFolderId:   clientChannels.driveFolderId,
      instagramHandle: clientChannels.instagramHandle,
    })
    .from(clientChannels)
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)))
    .limit(1);

  const chanRow = chanRows[0];
  const driveFolderId = chanRow?.driveFolderId;
  if (!driveFolderId) {
    throw new Error(`ig-trawl: no driveFolderId for client=${clientId} channel=${channel}`);
  }

  const drive = new DriveApiClient(
    googleClientId,
    googleClientSecret,
    tokens,
    async (t) => {
      try {
        await storeTokens(db, encProvider, clientId, 'drive', t);
      } catch (err) {
        logger.warn({ ...logCtx, err }, 'ig-trawl: Drive token refresh write-back failed — will self-heal on next call');
      }
    },
  );

  await trawlInstagramPosts({
    clientId, channel, month: dataMonth,
    handle: chanRow.instagramHandle ?? undefined,
    driveFolderId, drive, apifyApiKey, logger,
  });
}
