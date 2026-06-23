/**
 * verify-drive-token.ts — Gate 2 full round-trip verification.
 *
 * Proves the two load-bearing bets for Stage 3:
 *   (a) stored Drive tokens decrypt and authorise via the Railway token path
 *   (b) the Drive API supports the exact operations Stage 3/4/5 depend on:
 *       create → download → update → download → metadata → changes feed
 *
 * The changesList assertion is the critical one: if a file we just created/updated
 * does NOT appear in changesList(TOKEN_BEFORE), the Stage 3 poller cannot work and
 * we learn that NOW rather than after building it.
 *
 * Usage:
 *   tsx src/verify-drive-token.ts <client-slug> <drive-folder-id>
 *
 * Auth: getTokens() → KMS-envelope-decrypt → DriveApiClient.
 * No service-account key, no local-creds shortcut — same path the worker uses.
 *
 * Run against both an app-created folder AND a shared-to-app folder to surface
 * any drive.file scope restrictions before Stage 3 is built.
 */

import { db, clients } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { getTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { env } from './env.js';

// ── Known test bytes (exact content asserted on download) ────────────────────

const V1 = Buffer.from('gate2-verification-v1\n');
const V2 = Buffer.from('gate2-verification-v2-updated\n');

// ── Assertion helper ─────────────────────────────────────────────────────────

class AssertionError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'AssertionError';
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new AssertionError(message);
}

// ── Args ─────────────────────────────────────────────────────────────────────

const slug = process.argv[2];
const folderId = process.argv[3];

if (!slug || !folderId) {
  console.error('Usage: tsx src/verify-drive-token.ts <client-slug> <drive-folder-id>');
  process.exit(1);
}

// ── Resolve client ───────────────────────────────────────────────────────────

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

// ── Decrypt stored tokens (Railway token path) ───────────────────────────────

const encProvider = createEncryptionProvider();
const tokens = await getTokens(db, encProvider, clientId, 'drive');

if (!tokens) {
  console.error(
    `No Drive tokens for client '${slug}'.\n` +
    `Run first: tsx src/setup-drive-oauth.ts ${slug}`,
  );
  process.exit(1);
}

// ── Header (self-documenting) ─────────────────────────────────────────────────

console.log('\nGate 2 verification — Drive round-trip + change-tracking\n');
console.log(`  Client:   ${slug} (${clientId})`);
console.log(`  Folder:   ${folderId}`);
console.log(`  Account:  ${tokens.emailAddress ?? '(not stored)'}`);
console.log(`  Scopes:   ${tokens.scopes.join(', ')}`);
console.log('');

// ── Build Drive client ────────────────────────────────────────────────────────

const drive = new DriveApiClient(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  tokens,
  async (_refreshed) => { /* verification run — do not persist refreshed tokens */ },
);

// ── Round-trip ────────────────────────────────────────────────────────────────

let fileId: string | null = null;
let passed = false;

try {
  // Step 1 — capture changes-feed anchor BEFORE any writes
  process.stdout.write('Step 1  getStartPageToken ...\n');
  const tokenBefore = await drive.getStartPageToken();
  assert(tokenBefore.length > 0, 'getStartPageToken returned empty string');
  console.log(`        ✓ TOKEN_BEFORE = ${tokenBefore.slice(0, 24)}...`);

  // Step 2 — create test file; capture fileId for all subsequent assertions + cleanup
  process.stdout.write('Step 2  createFile(gate2-test.txt) ...\n');
  fileId = await drive.createFile(folderId, 'gate2-test.txt', 'text/plain', V1);
  assert(fileId.length > 0, 'createFile returned empty fileId — folder may not be accessible with current scope');
  console.log(`        ✓ fileId = ${fileId}`);

  // Step 3 — download and assert exact V1 bytes
  process.stdout.write('Step 3  downloadFile → assert V1 bytes ...\n');
  const dl1 = await drive.downloadFile(fileId);
  assert(
    dl1.equals(V1),
    `V1 byte mismatch — got ${dl1.length} bytes (${dl1.toString('utf8').trim()}), expected ${V1.length} bytes`,
  );
  console.log(`        ✓ ${dl1.length} bytes match V1`);

  // Step 4 — overwrite with V2
  process.stdout.write('Step 4  updateFile(V2) ...\n');
  await drive.updateFile(fileId, 'text/plain', V2);
  console.log('        ✓ updated');

  // Step 5 — download and assert exact V2 bytes
  process.stdout.write('Step 5  downloadFile → assert V2 bytes ...\n');
  const dl2 = await drive.downloadFile(fileId);
  assert(
    dl2.equals(V2),
    `V2 byte mismatch — got ${dl2.length} bytes (${dl2.toString('utf8').trim()}), expected ${V2.length} bytes`,
  );
  console.log(`        ✓ ${dl2.length} bytes match V2`);

  // Step 6 — metadata: assert name + id present
  process.stdout.write('Step 6  getFileMeta → assert name + id ...\n');
  const meta = await drive.getFileMeta(fileId);
  assert(meta.id === fileId, `meta.id mismatch — got '${meta.id}', expected '${fileId}'`);
  assert(meta.name === 'gate2-test.txt', `meta.name mismatch — got '${meta.name}'`);
  console.log(`        ✓ name=${meta.name}  id=${meta.id}`);

  // Step 7 — LOAD-BEARING: assert fileId appears in the changes feed
  //   If this fails with drive.file scope on a shared folder, Stage 3's poller
  //   will not detect edits the client makes — the scope must be widened.
  process.stdout.write('Step 7  changesList(TOKEN_BEFORE) → assert fileId in changes ...\n');
  const { fileIds: changedIds } = await drive.changesList(tokenBefore);
  assert(
    changedIds.includes(fileId),
    `fileId ${fileId} NOT found in changesList — ${changedIds.length} change(s) returned.\n` +
    `  This means drive.file scope cannot see the change in this folder.\n` +
    `  Re-run with drive or drive.readonly scope, or use an app-owned folder.`,
  );
  console.log(`        ✓ fileId found in ${changedIds.length} change(s)`);

  passed = true;

} catch (err) {
  if (err instanceof AssertionError) {
    console.error(`\n✗ FAIL: ${err.message}`);
  } else {
    console.error(`\n✗ ERROR (unexpected): ${String(err)}`);
  }
} finally {
  // Step 8 — cleanup: always attempt delete so the folder stays clean
  if (fileId !== null) {
    process.stdout.write('Step 8  cleanup: deleteFile(gate2-test.txt) ...\n');
    try {
      await drive.deleteFile(fileId);
      console.log('        ✓ deleted');
    } catch (e) {
      console.warn(`        ⚠ cleanup failed (${String(e)}) — delete manually: ${fileId}`);
    }
  }
}

if (passed) {
  console.log('\n✓ Gate 2 PASS: full Drive round-trip with change-tracking confirmed.\n');
  process.exit(0);
} else {
  process.exit(1);
}
