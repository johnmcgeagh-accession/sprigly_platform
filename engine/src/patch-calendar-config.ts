/**
 * patch-calendar-config.ts — one-off: download, patch, and re-upload calendar-config.json
 * for a client's Drive channel folder.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker patch-calendar-config <slug> <channel>
 *
 * Reads the file from Drive, merges the patch defined below, and calls updateFile.
 * Never creates a duplicate — fails if calendar-config.json is not already present.
 */

import { db, clients, clientChannels } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { getTokens, createEncryptionProvider, storeTokens } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { env } from './env.js';

const slug    = process.argv[2];
const channel = process.argv[3];

if (!slug || !channel) {
  console.error('Usage: pnpm --filter @sprigly/worker patch-calendar-config <slug> <channel>');
  process.exit(1);
}

// ── Patch to apply ────────────────────────────────────────────────────────────
// Edit this block when running for a different client.
const PATCH: Record<string, unknown> = {
  contact_name:  'Sally',
  contact_email: 'john.mcgeagh@gmail.com',
  extra_questions: [
    "Any particular outfit pairings or \"Sunday Styles\" sets in mind?",
    "Any new colourways or fabric stories, anything sustainability-led worth leading on?",
  ],
};
// ─────────────────────────────────────────────────────────────────────────────

const clientRows = await db
  .select({ id: clients.id, name: clients.name })
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

const driveFolderId = channelRows[0]?.driveFolderId;
if (!driveFolderId) {
  console.error(`No driveFolderId for ${slug}/${channel}`);
  process.exit(1);
}

const encProvider = createEncryptionProvider();
const tokens = await getTokens(db, encProvider, clientRow.id, 'drive');
if (!tokens) { console.error(`No Drive tokens for ${slug}`); process.exit(1); }

const drive = new DriveApiClient(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  tokens,
  async (t) => { await storeTokens(db, encProvider, clientRow.id, 'drive', t); },
);

const folderFiles = await drive.listFiles(driveFolderId);
const configMeta  = folderFiles.find((f) => f.name === 'calendar-config.json');
if (!configMeta) {
  console.error(`calendar-config.json not found in Drive folder ${driveFolderId} for ${slug}/${channel}`);
  process.exit(1);
}

const configBuf = await drive.downloadFile(configMeta.id);
const before    = JSON.parse(configBuf.toString('utf-8')) as Record<string, unknown>;

console.log('\nBEFORE (relevant fields only):');
console.log('  contact_name:    ', before['contact_name']    ?? '(absent)');
console.log('  contact_email:   ', before['contact_email']   ?? '(absent)');
console.log('  extra_questions: ', JSON.stringify(before['extra_questions'] ?? '(absent)'));

const after = { ...before, ...PATCH };

console.log('\nAFTER (relevant fields only):');
console.log('  contact_name:    ', after['contact_name']);
console.log('  contact_email:   ', after['contact_email']);
console.log('  extra_questions: ', JSON.stringify(after['extra_questions']));

await drive.updateFile(
  configMeta.id,
  'application/json',
  Buffer.from(JSON.stringify(after, null, 2)),
);

console.log(`\n✓ calendar-config.json updated (fileId=${configMeta.id})`);
