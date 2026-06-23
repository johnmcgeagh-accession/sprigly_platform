/**
 * verify-drive-token.ts — Gate 2 verification for the content-calendar pipeline.
 *
 * Proves TWO things in one run:
 *   1. Stored Drive tokens decrypt correctly via the Railway token path
 *      (getTokens → KMS-envelope-decrypt → access_token)
 *   2. The Drive API client can make a real authenticated request using those tokens
 *
 * Usage:
 *   tsx src/verify-drive-token.ts <client-slug> [drive-folder-id]
 *
 *   client-slug   — required; must have Drive tokens stored via setup-drive-oauth.ts
 *   drive-folder-id — optional; if provided, lists files in that folder as a read I/O check
 *
 * Run this after setup-drive-oauth.ts, with the same encryption provider env vars set.
 * Gate 2 is satisfied when this script exits 0 and reports a successful Drive API response.
 */

import { db, clients } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { getTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { env } from './env.js';

const slug = process.argv[2];
const folderId = process.argv[3];

if (!slug) {
  console.error('Usage: tsx src/verify-drive-token.ts <client-slug> [drive-folder-id]');
  process.exit(1);
}

// ── 1. Resolve client ─────────────────────────────────────────────────────────
const rows = await db
  .select({ id: clients.id })
  .from(clients)
  .where(eq(clients.slug, slug))
  .limit(1);

const clientRow = rows[0];
if (!clientRow) {
  console.error(`Client not found: ${slug}`);
  process.exit(1);
}

const clientId = clientRow.id;
console.log(`\nClient:    ${slug} (${clientId})`);

// ── 2. Decrypt stored Drive tokens (Railway token path) ───────────────────────
console.log('Step 1: decrypt stored Drive tokens via KMS envelope path ...');

const encProvider = createEncryptionProvider();
const tokens = await getTokens(db, encProvider, clientId, 'drive');

if (!tokens) {
  console.error(
    'No Drive tokens found for this client.\n' +
    `Run first: tsx src/setup-drive-oauth.ts ${slug}`,
  );
  process.exit(1);
}

console.log('         ✓ tokens decrypted');
console.log(`         scopes: ${tokens.scopes.join(', ')}`);
if (tokens.emailAddress) {
  console.log(`         account: ${tokens.emailAddress}`);
}

// ── 3. Build Drive client and make a real API call ────────────────────────────
console.log('Step 2: make authenticated Drive API call ...');

const driveClient = new DriveApiClient(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  tokens,
  async (refreshed) => {
    // During verification we don't persist refreshed tokens — this is read-only probe.
    console.log('         (access token refreshed during call)');
    void refreshed;
  },
);

// Always: confirm the Drive account identity via about.get.
const email = await driveClient.getAuthorizedEmail();
if (email) {
  console.log(`         ✓ about.get → Drive account: ${email}`);
} else {
  console.log('         ✓ about.get responded (email not returned)');
}

// Optional: list files in a folder if one was provided.
if (folderId) {
  console.log(`Step 3: list files in folder ${folderId} ...`);
  const files = await driveClient.listFiles(folderId);
  console.log(`         ✓ files.list → ${files.length} file(s)`);
  for (const f of files.slice(0, 5)) {
    console.log(`           - ${f.name} (${f.mimeType}, modified: ${f.modifiedTime})`);
  }
  if (files.length > 5) {
    console.log(`           ... and ${files.length - 5} more`);
  }
}

console.log('\n✓ Gate 2 PASS: stored tokens decrypt and Drive API responds.\n');

process.exit(0);
