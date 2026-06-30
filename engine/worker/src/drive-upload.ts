/**
 * drive-upload.ts — upload a local file into a client channel's Drive folder
 * using the app's stored tokens (drive.file scope).
 *
 * Required because drive.file only sees app-created files in changesList and
 * listFiles. Files uploaded via the Drive web UI are user-owned and invisible
 * to the poller.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker drive-upload <client-slug> <channel> <local-file-path>
 *
 * MIME type is inferred from the file extension:
 *   .csv  → text/csv
 *   .json → application/json
 *   .xlsx → application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 *   other → application/octet-stream
 */

import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { db, clients, clientChannels } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { getTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { env } from './env.js';

const slug      = process.argv[2];
const channel   = process.argv[3];
const localPath = process.argv[4];

if (!slug || !channel || !localPath) {
  console.error('Usage: pnpm --filter @sprigly/worker drive-upload <slug> <channel> <local-file-path>');
  process.exit(1);
}

const MIME: Record<string, string> = {
  '.csv':  'text/csv',
  '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const ext      = extname(localPath).toLowerCase();
const mimeType = MIME[ext] ?? 'application/octet-stream';
const name     = basename(localPath);

const clientRows = await db.select({ id: clients.id }).from(clients).where(eq(clients.slug, slug)).limit(1);
const clientRow  = clientRows[0];
if (!clientRow) { console.error(`Client not found: ${slug}`); process.exit(1); }

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

const encProvider = createEncryptionProvider();
const tokens = await getTokens(db, encProvider, clientRow.id, 'drive');
if (!tokens) { console.error(`No Drive tokens for ${slug}`); process.exit(1); }

const drive = new DriveApiClient(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, tokens, async () => {});

const content = readFileSync(localPath);
const fileId  = await drive.createFile(channelRow.driveFolderId, name, mimeType, content);

console.log(`Uploaded: ${name}  (${mimeType})`);
console.log(`fileId:   ${fileId}`);
console.log(`folder:   ${channelRow.driveFolderId}`);
