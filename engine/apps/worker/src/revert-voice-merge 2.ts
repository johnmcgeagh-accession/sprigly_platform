/**
 * revert-voice-merge.ts — roll back a voice-merge run for a given client/channel/month.
 *
 * Default: DRY RUN — prints current snapshot, prior snapshot, and affected edit counts.
 *          No database writes or Drive changes until --confirm is passed.
 *
 * Usage:
 *   pnpm revert-voice-merge [clientId] [channel] [months]
 *   pnpm revert-voice-merge [clientId] [channel] [months] --confirm
 *   pnpm revert-voice-merge [clientId] [channel] [months] --confirm --clean-facts
 *
 * Defaults: c79cf1c5-b51d-4a9b-aedc-48577df43e8f / instagram / 2026-07
 *
 * --confirm:     flip snapshots, mark run rolled_back, reset edits to pending
 * --clean-facts: also strip the month section from client-facts.md in Drive
 *                (re-running merge-voice will re-append factual deltas — see warning below)
 */

import { eq, and, desc, asc } from 'drizzle-orm';
import { db, voiceSnapshots, voiceEdits, clientChannels } from '@sprigly/db';
import { createEncryptionProvider, getTokens, storeTokens } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import pino from 'pino';
import { rollbackVoice } from './voice-consumer.js';

const logger = pino({ level: 'info' });

// ── Args ──────────────────────────────────────────────────────────────────────

const rawArgs    = process.argv.slice(2);
const confirm    = rawArgs.includes('--confirm');
const cleanFacts = rawArgs.includes('--clean-facts');
const positional = rawArgs.filter((a) => !a.startsWith('--'));

const clientId     = positional[0] ?? 'c79cf1c5-b51d-4a9b-aedc-48577df43e8f';
const channel      = positional[1] ?? 'instagram';
const months       = positional[2] ?? '2026-07';
const channelTitle = channel.charAt(0).toUpperCase() + channel.slice(1);

// ── Env ───────────────────────────────────────────────────────────────────────

const googleClientId     = process.env['GOOGLE_CLIENT_ID'];
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];

if (!googleClientId || !googleClientSecret) {
  console.error('Missing required env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET');
  process.exit(1);
}

const encProvider = createEncryptionProvider();

// ── Inspect current state (always runs) ──────────────────────────────────────

console.log(`\nRevert target: ${clientId} / ${channel} / ${months}`);
console.log(`Mode:          ${confirm ? '--confirm (WRITES)' : 'DRY RUN (no writes)'}`);
if (cleanFacts) console.log('               + --clean-facts');
console.log();

// Current snapshot
const currentRows = await db
  .select()
  .from(voiceSnapshots)
  .where(and(
    eq(voiceSnapshots.clientId, clientId),
    eq(voiceSnapshots.channel,  channel),
    eq(voiceSnapshots.isCurrent, true),
  ))
  .limit(1);

const current = currentRows[0];
if (!current) {
  console.error(`No current snapshot for ${clientId}/${channel} — nothing to revert`);
  process.exit(1);
}

console.log('CURRENT SNAPSHOT (would be replaced):');
console.log(`  id:           ${current.id}`);
console.log(`  run_id:       ${current.runId ?? '(none)'}`);
console.log(`  source_month: ${current.sourceMonth ?? '(none)'}`);
console.log(`  reason:       ${current.reason}`);
console.log(`  created_at:   ${current.createdAt.toISOString()}`);
console.log(`  length:       ${current.snapshotMd.length} chars`);
console.log();

// Prior snapshot (what we'd restore to)
const priorRows = await db
  .select()
  .from(voiceSnapshots)
  .where(and(
    eq(voiceSnapshots.clientId,  clientId),
    eq(voiceSnapshots.channel,   channel),
    eq(voiceSnapshots.isCurrent, false),
  ))
  .orderBy(desc(voiceSnapshots.createdAt))
  .limit(1);

const prior = priorRows[0];
console.log('PRIOR SNAPSHOT (would restore to):');
if (!prior) {
  console.log('  (none — no previous snapshot exists)');
} else {
  console.log(`  id:           ${prior.id}`);
  console.log(`  source_month: ${prior.sourceMonth ?? '(none)'}`);
  console.log(`  reason:       ${prior.reason}`);
  console.log(`  created_at:   ${prior.createdAt.toISOString()}`);
  console.log(`  length:       ${prior.snapshotMd.length} chars`);
}
console.log();

// Edits consumed by the run that produced the current snapshot
const runId = current.runId;
const affectedEdits = runId
  ? await db
    .select()
    .from(voiceEdits)
    .where(eq(voiceEdits.ingestionRunId, runId))
  : [];

const byMonth: Record<string, number> = {};
for (const e of affectedEdits) {
  byMonth[e.month] = (byMonth[e.month] ?? 0) + 1;
}

console.log(`AFFECTED EDITS (consumed by run ${runId ?? '(none)'}): ${affectedEdits.length} total`);
if (affectedEdits.length === 0) {
  console.log('  (none)');
} else {
  for (const [m, count] of Object.entries(byMonth)) {
    console.log(`  ${m}: ${count} edit${count === 1 ? '' : 's'}`);
  }
}
console.log();

if (!confirm) {
  console.log('── DRY RUN COMPLETE. Pass --confirm to apply. ──\n');
  process.exit(0);
}

// ── Confirm: apply rollback ───────────────────────────────────────────────────

if (!prior) {
  console.error('Cannot --confirm: no prior snapshot to restore to');
  process.exit(1);
}

console.log('Applying rollback...');
console.log(`  Will flip is_current: ${current.id} → false`);
console.log(`  Will flip is_current: ${prior.id} → true`);
if (runId) console.log(`  Will mark run ${runId} → rolled_back`);
if (affectedEdits.length > 0) {
  console.log(`  Will reset ${affectedEdits.length} edit${affectedEdits.length === 1 ? '' : 's'} → pending`);
}
console.log();

// Snapshot flip + Drive voice.md regeneration (delegates to rollbackVoice)
await rollbackVoice(
  db, encProvider, googleClientId, googleClientSecret,
  clientId, channel, logger,
  prior.id,
);

// Reset consumed edits back to pending
if (affectedEdits.length > 0 && runId) {
  await db
    .update(voiceEdits)
    .set({ ingestedAt: null, ingestionRunId: null, updatedAt: new Date() })
    .where(eq(voiceEdits.ingestionRunId, runId));
  console.log(`  Reset ${affectedEdits.length} edit${affectedEdits.length === 1 ? '' : 's'} to pending.`);
}

console.log('  Rollback committed.\n');

// ── --clean-facts ─────────────────────────────────────────────────────────────

if (cleanFacts) {
  console.log(`Cleaning client-facts.md: "${channelTitle} — ${months}"`);
  console.log('  WARNING: re-running merge-voice will re-append factual deltas for this month.');
  console.log();

  const tokens = await getTokens(db, encProvider, clientId, 'drive');
  if (!tokens) {
    console.error('  No Drive tokens found — cannot clean client-facts.md');
    process.exit(1);
  }

  const drive = new DriveApiClient(
    googleClientId, googleClientSecret, tokens,
    (refreshed) => storeTokens(db, encProvider, clientId, 'drive', refreshed),
  );

  // Client-canonical Drive folder: first-alphabetical channel's folder
  const allChannelRows = await db
    .select({ driveFolderId: clientChannels.driveFolderId })
    .from(clientChannels)
    .where(eq(clientChannels.clientId, clientId))
    .orderBy(asc(clientChannels.channel));

  const clientFolderDriveId = allChannelRows[0]?.driveFolderId;
  if (!clientFolderDriveId) {
    console.error('  No Drive folder found for this client');
    process.exit(1);
  }

  const folderFiles = await drive.listFiles(clientFolderDriveId);
  const factsFile   = folderFiles.find((f) => f.name === 'client-facts.md');

  if (!factsFile) {
    console.log('  client-facts.md not found in Drive — nothing to clean');
  } else {
    const buf     = await drive.downloadFile(factsFile.id);
    const content = buf.toString('utf-8');

    const sectionHeading = `\n## ${channelTitle} — ${months}`;
    const sectionStart   = content.indexOf(sectionHeading);

    if (sectionStart === -1) {
      console.log(`  Section "${channelTitle} — ${months}" not found — nothing to strip`);
    } else {
      const nextSection = content.indexOf('\n## ', sectionStart + sectionHeading.length);
      const cleaned     = (
        nextSection === -1
          ? content.slice(0, sectionStart)
          : content.slice(0, sectionStart) + content.slice(nextSection)
      ).trimEnd() + '\n';

      await drive.updateFile(factsFile.id, 'text/plain; charset=utf-8', Buffer.from(cleaned, 'utf-8'));
      console.log(`  Stripped "${channelTitle} — ${months}" from client-facts.md`);
    }
  }
  console.log();
}

console.log('Done.\n');
