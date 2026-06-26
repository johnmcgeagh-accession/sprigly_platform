/**
 * probe-lean-line.ts — one-off diagnostic for IVY-T instagram May 2026.
 *
 * Confirms Drive files are found, parsed, and the Haiku join fires.
 * Prints nothing to Gmail / Drive — read-only.
 *
 * NOT for committing.
 *
 * Run:
 *   pnpm --filter @sprigly/worker tsx src/probe-lean-line.ts
 */

import pino from 'pino';
import { eq, and } from 'drizzle-orm';
import { db, clients, clientChannels } from '@sprigly/db';
import { getTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { createModelClientFromEnv } from '@sprigly/model-client';
import { buildLeanLine } from './lean-line.js';
import { DbPromptResolver } from '@sprigly/prompts';
import { env } from './env.js';

// ── Config ────────────────────────────────────────────────────────────────────

const SLUG    = 'ivy-t';      // expected clientId starts with c79cf1c5
const CHANNEL = 'instagram';
const MONTH   = '2026-05';

const logger = pino({ name: 'probe-lean-line', level: 'info' });

// ── Resolve client ────────────────────────────────────────────────────────────

const clientRows = await db
  .select({ id: clients.id, name: clients.name })
  .from(clients)
  .where(eq(clients.slug, SLUG))
  .limit(1);

const clientRow = clientRows[0];
if (!clientRow) {
  console.error(`Client not found for slug: ${SLUG}`);
  process.exit(1);
}

if (!clientRow.id.startsWith('c79cf1c5')) {
  console.warn(`WARNING: resolved clientId ${clientRow.id} does not start with c79cf1c5 — check slug`);
}

// ── Resolve channel / Drive folder ────────────────────────────────────────────

const channelRows = await db
  .select({ driveFolderId: clientChannels.driveFolderId })
  .from(clientChannels)
  .where(
    and(
      eq(clientChannels.clientId, clientRow.id),
      eq(clientChannels.channel, CHANNEL),
    ),
  )
  .limit(1);

const channelRow = channelRows[0];
if (!channelRow?.driveFolderId) {
  console.error(`No drive_folder_id for ${SLUG}/${CHANNEL}`);
  process.exit(1);
}

const { driveFolderId } = channelRow;

// ── Build Drive client ────────────────────────────────────────────────────────

const encProvider = createEncryptionProvider();
const tokens = await getTokens(db, encProvider, clientRow.id, 'drive');
if (!tokens) {
  console.error(`No Drive tokens for client ${clientRow.id}`);
  process.exit(1);
}

// Token refresh is a no-op here: probe is read-only and short-lived.
const drive = new DriveApiClient(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  tokens,
  async () => {},
);

// ── Build model client ────────────────────────────────────────────────────────

const model = createModelClientFromEnv();

// ── Print context ─────────────────────────────────────────────────────────────

console.log('');
console.log(`client:       ${clientRow.name}  (${clientRow.id})`);
console.log(`channel:      ${CHANNEL}`);
console.log(`month:        ${MONTH}`);
console.log(`drive folder: ${driveFolderId}`);
console.log('');

// ── Check source files ────────────────────────────────────────────────────────

console.log('SOURCE CHECKS');
const folderFiles = await drive.listFiles(driveFolderId);

const salesFileName = `sales-${MONTH}.csv`;
const igFileName    = `instagram-posts-${MONTH}.json`;

const salesMeta = folderFiles.find((f) => f.name.toLowerCase() === salesFileName);
const igMeta    = folderFiles.find((f) => f.name.toLowerCase() === igFileName);

console.log(`  ${salesMeta ? '✓' : '✗'}  ${salesFileName}${salesMeta ? '' : '  (not found — sales source will be null)'}`);
console.log(`  ${igMeta   ? '✓' : '✗'}  ${igFileName}${igMeta    ? '' : '  (not found — engagement source will be null)'}`);
console.log('');

if (!salesMeta && !igMeta) {
  console.log('Both source files absent — buildLeanLine will return null without calling the model.');
  console.log('Drop at least one file into the Drive folder and re-run.');
  process.exit(0);
}

// ── Call buildLeanLine ────────────────────────────────────────────────────────

console.log('calling buildLeanLine...');
console.log('');

const prompts = new DbPromptResolver(db);

const leanLine = await buildLeanLine({
  clientId:      clientRow.id,
  clientName:    clientRow.name,
  channel:       CHANNEL,
  month:         MONTH,
  driveFolderId,
  drive,
  model,
  logger,
  prompts,
});

// ── Print result ──────────────────────────────────────────────────────────────

console.log('');
console.log('RESULT');
if (leanLine) {
  console.log(`  lean-line: "${leanLine}"`);
} else {
  console.log('  lean-line: null  (email caller should omit the lean section)');
}
console.log('');
