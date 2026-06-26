/**
 * ig-trawl.ts — CLI entry point for trawling Instagram posts for a client.
 *
 * Fetches the previous (or specified) month's posts via Apify and writes
 * instagram-posts-YYYY-MM.json to the client's Drive folder, idempotently.
 * The file is then read by lean-line.ts on the next monthly email run.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker ig-trawl <client-slug> <channel> <YYYY-MM>
 *
 * Requires APIFY_API_KEY in env (.env.local, loaded by the package.json script).
 */

import pino from 'pino';
import { eq, and } from 'drizzle-orm';
import { db, clients, clientChannels } from '@sprigly/db';
import { getTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { env } from './env.js';
import { trawlInstagramPosts } from './ig-producer.js';

const slug    = process.argv[2];
const channel = process.argv[3];
const month   = process.argv[4];

if (!slug || !channel || !month || !/^\d{4}-\d{2}$/.test(month)) {
  console.error('Usage: pnpm --filter @sprigly/worker ig-trawl <slug> <channel> <YYYY-MM>');
  console.error('  e.g. pnpm --filter @sprigly/worker ig-trawl ivy-t instagram 2026-05');
  process.exit(1);
}

const logger = pino({ name: 'ig-trawl', level: 'info' });

// ── Resolve client ────────────────────────────────────────────────────────────

const clientRows = await db
  .select({ id: clients.id })
  .from(clients)
  .where(eq(clients.slug, slug))
  .limit(1);

const clientRow = clientRows[0];
if (!clientRow) { console.error(`Client not found: ${slug}`); process.exit(1); }

// ── Resolve channel / Drive folder ────────────────────────────────────────────

const channelRows = await db
  .select({ driveFolderId: clientChannels.driveFolderId })
  .from(clientChannels)
  .where(and(eq(clientChannels.clientId, clientRow.id), eq(clientChannels.channel, channel)))
  .limit(1);

const channelRow = channelRows[0];
if (!channelRow?.driveFolderId) {
  console.error(`No drive_folder_id for ${slug}/${channel}`);
  process.exit(1);
}

// ── Drive client ──────────────────────────────────────────────────────────────

const encProvider = createEncryptionProvider();
const tokens      = await getTokens(db, encProvider, clientRow.id, 'drive');
if (!tokens) { console.error(`No Drive tokens for ${slug}`); process.exit(1); }

const drive = new DriveApiClient(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  tokens,
  async () => {},
);

// ── Run ───────────────────────────────────────────────────────────────────────

await trawlInstagramPosts({
  clientId:      clientRow.id,
  channel,
  month,
  driveFolderId: channelRow.driveFolderId,
  drive,
  apifyApiKey:   process.env['APIFY_API_KEY'],
  logger,
});
