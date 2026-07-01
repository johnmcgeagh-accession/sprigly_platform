/**
 * seed-voice.ts — operator CLI to seed an initial voice snapshot from a local file.
 *
 * Usage:
 *   pnpm seed-voice <clientId> <channel> <path-to-voice.md> [--force]
 *
 * Reads the voice.md file, extracts the "## [Channel] — Voice Profile" block,
 * and writes it as voice_snapshots v1 with reason='operator-seed'.
 * Also writes the channel block to the Drive voice.md for the client.
 *
 * Idempotency: refuses if a current snapshot already exists, unless --force is passed.
 * --force flips the existing current snapshot to is_current=false first.
 */

import { readFileSync } from 'node:fs';
import { eq, and } from 'drizzle-orm';
import {
  db,
  voiceSnapshots,
  clientChannels,
} from '@sprigly/db';
import { getTokens, storeTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import pino from 'pino';
import {
  replaceChannelBlock,
  updateVoiceMdOnDrive,
} from './voice-consumer.js';

const logger = pino({ level: 'info' });

const args = process.argv.slice(2);
const force = args.includes('--force');
const positional = args.filter((a) => !a.startsWith('--'));
const [clientId, channel, filePath] = positional;

if (!clientId || !channel || !filePath) {
  console.error('Usage: pnpm seed-voice <clientId> <channel> <path-to-voice.md> [--force]');
  process.exit(1);
}

const googleClientId     = process.env['GOOGLE_CLIENT_ID'];
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];

if (!googleClientId || !googleClientSecret) {
  console.error('Missing required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET');
  process.exit(1);
}

const encProvider = createEncryptionProvider();

// ── Extract channel block from file ──────────────────────────────────────────

const channelTitle = channel.charAt(0).toUpperCase() + channel.slice(1);
const heading = `## ${channelTitle} — Voice Profile`;

const fileContent = readFileSync(filePath, 'utf-8');
const sections = fileContent.split(/(?=\n## )/);

let channelBlock: string | null = null;
for (const section of sections) {
  if (section.trimStart().startsWith(heading)) {
    channelBlock = section.trim();
    break;
  }
}

if (!channelBlock) {
  console.error(`No section matching "${heading}" found in ${filePath}`);
  console.error('Check that the channel name matches exactly (case-sensitive).');
  process.exit(1);
}

logger.info({ clientId, channel, blockLength: channelBlock.length }, 'seed-voice: channel block extracted');

// ── Check for existing current snapshot ──────────────────────────────────────

const existing = await db
  .select({ id: voiceSnapshots.id })
  .from(voiceSnapshots)
  .where(and(
    eq(voiceSnapshots.clientId, clientId),
    eq(voiceSnapshots.channel, channel),
    eq(voiceSnapshots.isCurrent, true),
  ))
  .limit(1);

if (existing.length > 0) {
  if (!force) {
    console.error(`A current voice snapshot already exists for ${clientId}/${channel} (id: ${existing[0]!.id}).`);
    console.error('Pass --force to overwrite it.');
    process.exit(1);
  }
  logger.info({ clientId, channel, existingId: existing[0]!.id }, 'seed-voice: --force: flipping existing snapshot to is_current=false');
}

// ── Write snapshot ────────────────────────────────────────────────────────────

await db.transaction(async (tx) => {
  if (existing.length > 0 && force) {
    await tx
      .update(voiceSnapshots)
      .set({ isCurrent: false, updatedAt: new Date() })
      .where(eq(voiceSnapshots.id, existing[0]!.id));
  }

  const [newRow] = await tx
    .insert(voiceSnapshots)
    .values({
      clientId,
      channel,
      snapshotMd: channelBlock!,
      reason:     'operator-seed',
      isCurrent:  true,
    })
    .returning({ id: voiceSnapshots.id });

  logger.info({ clientId, channel, snapshotId: newRow?.id }, 'seed-voice: snapshot written');
});

// ── Write Drive voice.md ──────────────────────────────────────────────────────

const channelRow = await db
  .select({ driveFolderId: clientChannels.driveFolderId })
  .from(clientChannels)
  .where(and(
    eq(clientChannels.clientId, clientId),
    eq(clientChannels.channel, channel),
  ))
  .limit(1);

const driveFolderId = channelRow[0]?.driveFolderId;
if (!driveFolderId) {
  logger.warn({ clientId, channel }, 'seed-voice: no drive_folder_id — voice.md not written to Drive');
  process.exit(0);
}

const tokens = await getTokens(db, encProvider, clientId, 'drive');
if (!tokens) {
  logger.warn({ clientId, channel }, 'seed-voice: no Drive tokens — voice.md not written to Drive');
  process.exit(0);
}

const drive = new DriveApiClient(
  googleClientId, googleClientSecret, tokens,
  (refreshed) => storeTokens(db, encProvider, clientId, 'drive', refreshed),
);

await updateVoiceMdOnDrive(db, drive, clientId, driveFolderId, channelTitle, channelBlock, logger);
logger.info({ clientId, channel }, 'seed-voice: voice.md written to Drive');
