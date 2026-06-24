/**
 * gate3-seed-xlsx.ts — create a test xlsx in the channel's Drive folder
 * using the app's stored Drive tokens (drive.file scope).
 *
 * This simulates what Stage 4 will do: the worker generates a calendar xlsx
 * and uploads it to the client's Sprigly-owned folder. Once uploaded, it is
 * visible to changesList and the Drive poller can detect future edits to it.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker gate3-seed-xlsx <client-slug> <channel>
 *
 * Prints the fileId. Save it — you'll need it to verify Gate 3 checks (c)+(d).
 */

import { db, clients, clientChannels } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { getTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { env } from './env.js';

const slug    = process.argv[2];
const channel = process.argv[3];

if (!slug || !channel) {
  console.error('Usage: pnpm --filter @sprigly/worker gate3-seed-xlsx <slug> <channel>');
  process.exit(1);
}

const clientRows = await db
  .select({ id: clients.id })
  .from(clients)
  .where(eq(clients.slug, slug))
  .limit(1);

const clientRow = clientRows[0];
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

const drive = new DriveApiClient(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  tokens,
  async () => {},
);

const name    = `gate3-test-calendar-${Date.now()}.xlsx`;
const content = Buffer.from(`gate3 test calendar placeholder — ${new Date().toISOString()}\n`);
const fileId  = await drive.createFile(channelRow.driveFolderId, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content);

console.log(`Created: ${name}`);
console.log(`fileId:  ${fileId}`);
console.log(`folder:  ${channelRow.driveFolderId}`);
console.log('');
console.log('The next worker poll tick will detect this file and enqueue calendar:detect-edits.');
console.log('After that, edit the file via Drive and run a second poll to test check (d).');
