/**
 * backfill-ig-posts-cli.ts — ONE-TIME, READ-ONLY-FROM-DRIVE backfill.
 *
 * Reads a client's existing instagram-posts-<YYYY-MM>.json files from their Google
 * Drive folder and upserts each into the new ig_posts DB table, so the critic and
 * lean line keep their history after IG data is re-homed off Drive.
 *
 * SAFETY:
 *   - Read-only with respect to Drive: it downloads the JSON files and NEVER deletes,
 *     renames, or writes anything back to Drive. The Drive files are left in place.
 *   - Idempotent: latest-wins upsert per (client_id, channel, month). Re-running
 *     replaces each month's row with the same content — no duplicates.
 *
 * Usage: pnpm --filter @sprigly/worker backfill-ig-posts <client-slug> <channel>
 *   e.g. pnpm --filter @sprigly/worker backfill-ig-posts ivy-t instagram
 */

import pino from 'pino';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db, clients, clientChannels, igPosts } from '@sprigly/db';
import { createEncryptionProvider, getTokens, storeTokens } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { env } from '../env.js';
import { igPostSchema } from '../lean-line.js';

const igPostsArraySchema = z.array(igPostSchema);
const FILE_RE = /^instagram-posts-(\d{4}-\d{2})\.json$/i;

const slug    = process.argv[2];
const channel = process.argv[3];

if (!slug || !channel) {
  console.error('Usage: pnpm --filter @sprigly/worker backfill-ig-posts <client-slug> <channel>');
  console.error('  e.g. pnpm --filter @sprigly/worker backfill-ig-posts ivy-t instagram');
  process.exit(1);
}

const logger = pino({ name: 'backfill-ig-posts', level: 'info' });

const [clientRow] = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug)).limit(1);
if (!clientRow) { console.error(`Client not found: ${slug}`); process.exit(1); }
const clientId = clientRow.id;

const [chanRow] = await db
  .select({ driveFolderId: clientChannels.driveFolderId })
  .from(clientChannels)
  .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)))
  .limit(1);
const driveFolderId = chanRow?.driveFolderId;
if (!driveFolderId) { console.error(`No drive_folder_id for ${slug}/${channel} — nothing to backfill`); process.exit(1); }

const encProvider = createEncryptionProvider();
const tokens = await getTokens(db, encProvider, clientId, 'drive');
if (!tokens) { console.error(`No Drive tokens for ${slug} — cannot read the existing IG files`); process.exit(1); }

const drive = new DriveApiClient(
  env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, tokens,
  (refreshed) => storeTokens(db, encProvider, clientId, 'drive', refreshed),
);

const files = await drive.listFiles(driveFolderId);
const igFiles = files
  .map((f) => ({ f, m: FILE_RE.exec(f.name) }))
  .filter((x): x is { f: typeof files[number]; m: RegExpExecArray } => x.m !== null);

if (igFiles.length === 0) { console.log(`No instagram-posts-*.json files in ${slug}/${channel} Drive folder — nothing to backfill.`); process.exit(0); }

let totalRows = 0;
let totalPosts = 0;
for (const { f, m } of igFiles) {
  const month = m[1]!;
  try {
    const raw = JSON.parse((await drive.downloadFile(f.id)).toString('utf-8')) as unknown;
    const posts = igPostsArraySchema.parse(raw);
    const payload = posts as unknown as Array<Record<string, unknown>>;
    await db
      .insert(igPosts)
      .values({ clientId, channel, month, posts: payload })
      .onConflictDoUpdate({
        target: [igPosts.clientId, igPosts.channel, igPosts.month],
        set:    { posts: payload, updatedAt: new Date() },
      });
    totalRows++;
    totalPosts += posts.length;
    console.log(`  ✓ ${f.name} → ig_posts (${slug}/${channel}/${month}): ${posts.length} posts`);
  } catch (err) {
    console.error(`  ✗ ${f.name}: ${err instanceof Error ? err.message : String(err)} — skipped (Drive file left untouched)`);
  }
}

logger.info({ slug, channel, months: totalRows, posts: totalPosts }, 'backfill-ig-posts: complete');
console.log(`\nBackfill complete: ${totalRows} month row(s), ${totalPosts} posts total. Drive files left in place.`);
process.exit(0);
