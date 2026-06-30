/**
 * verify-drive-clientedit.ts — Two-phase proof that a CLIENT edit on a
 * Sprigly-owned file surfaces in Sprigly's Drive changesList.
 *
 * Why this exists:
 *   verify-drive-token.ts proved the WORKER creating a file shows in changesList.
 *   That is not sufficient: Stage 3's poller must detect edits made by the CLIENT
 *   (a different Google account), not just edits made by the worker itself.
 *   This script tests that specific boundary under drive.file scope.
 *
 * The test runs in two phases with a manual client action in between — Claude
 * Code cannot authenticate as a second Google account.
 *
 * Phase 1 — setup (Sprigly creates the file, waits for client action):
 *   pnpm --filter @sprigly/worker verify-drive-clientedit <slug> <folder-id> setup <client-email>
 *
 * [MANUAL STEP] — from the client account, make any edit to the file
 *
 * Phase 2 — check (assert the client edit appears in Sprigly's change feed):
 *   pnpm --filter @sprigly/worker verify-drive-clientedit <slug> <folder-id> check <TOKEN_FROM_PHASE1> <FILE_ID_FROM_PHASE1>
 *
 * Key design choice — TOKEN captured AFTER Phase 1 writes:
 *   The page token is captured at the end of Phase 1 (after create + share),
 *   so the changesList in Phase 2 sees ONLY post-creation changes. If the
 *   client edit surfaces, it means Drive propagates external-editor changes to
 *   the file owner's change feed — exactly what Stage 3 needs.
 *
 * Auth: getTokens() → KMS-decrypt → DriveApiClient. Same path as the worker.
 */

import { db, clients } from '@sprigly/db';
import { eq } from 'drizzle-orm';
import { getTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { DriveApiClient } from '@sprigly/sources';
import { env } from './env.js';

// ── Args ──────────────────────────────────────────────────────────────────────

const slug      = process.argv[2];
const folderId  = process.argv[3];
const phase     = process.argv[4];

if (!slug || !folderId || !phase) {
  console.error(
    'Usage:\n' +
    '  Phase 1: pnpm --filter @sprigly/worker verify-drive-clientedit <slug> <folder-id> setup <client-email>\n' +
    '  Phase 2: pnpm --filter @sprigly/worker verify-drive-clientedit <slug> <folder-id> check <TOKEN_FROM_PHASE1> <FILE_ID_FROM_PHASE1>',
  );
  process.exit(1);
}

// ── Resolve client ────────────────────────────────────────────────────────────

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

// ── Decrypt stored tokens (Railway KMS path) ──────────────────────────────────

const encProvider = createEncryptionProvider();
const tokens = await getTokens(db, encProvider, clientId, 'drive');

if (!tokens) {
  console.error(`No Drive tokens for '${slug}'. Run: setup-drive ${slug}`);
  process.exit(1);
}

// ── Drive client ──────────────────────────────────────────────────────────────

const drive = new DriveApiClient(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  tokens,
  async (_refreshed) => { /* verify run — do not persist */ },
);

// ── Header ────────────────────────────────────────────────────────────────────

console.log('\nDrive client-edit verification\n');
console.log(`  Client:  ${slug} (${clientId})`);
console.log(`  Folder:  ${folderId}`);
console.log(`  Account: ${tokens.emailAddress ?? '(not stored)'}`);
console.log(`  Scopes:  ${tokens.scopes.join(', ')}`);
console.log(`  Phase:   ${phase}\n`);

// ── Assertion helper ──────────────────────────────────────────────────────────

class AssertionError extends Error {
  constructor(msg: string) { super(msg); this.name = 'AssertionError'; }
}
function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new AssertionError(msg);
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 1 — setup
// ═════════════════════════════════════════════════════════════════════════════

if (phase === 'setup') {
  const clientEmail = process.argv[5];
  if (!clientEmail) {
    console.error('Phase 1 requires a <client-email> argument.');
    process.exit(1);
  }

  const INITIAL = Buffer.from('clientedit-test — initial content\n');
  let fileId: string | null = null;

  try {
    // Step 1 — create the test file
    process.stdout.write('Step 1  createFile(clientedit-test.txt) ...\n');
    fileId = await drive.createFile(folderId, 'clientedit-test.txt', 'text/plain', INITIAL);
    assert(fileId.length > 0, 'createFile returned empty fileId — folder may be inaccessible');
    console.log(`        ✓ fileId = ${fileId}`);

    // Step 2 — share to client; catch and surface if drive.file blocks permissions.create
    process.stdout.write(`Step 2  shareFile(${clientEmail}, role:writer) ...\n`);
    let sharedProgrammatically = false;
    try {
      await drive.shareFile(fileId, clientEmail, 'writer');
      console.log(`        ✓ Shared to ${clientEmail} as Editor`);
      sharedProgrammatically = true;
    } catch (shareErr) {
      console.log(`        ⚠ permissions.create failed under drive.file scope:`);
      console.log(`          ${String(shareErr)}`);
      console.log('');
      console.log('  FINDING: drive.file cannot set permissions on this file.');
      console.log('  Share manually before proceeding (see instructions below).');
    }

    // Step 3 — capture the anchor token AFTER all writes
    //   This ensures Phase 2's changesList sees ONLY post-creation events.
    //   If the client's edit appears, it's purely because Drive propagates
    //   external-editor changes to the file creator's change feed.
    process.stdout.write('Step 3  getStartPageToken() — anchor captured AFTER writes ...\n');
    const tokenForPhase2 = await drive.getStartPageToken();
    assert(tokenForPhase2.length > 0, 'getStartPageToken returned empty string');
    console.log(`        ✓ TOKEN_FOR_PHASE2 = ${tokenForPhase2}`);

    // ── Manual instructions ───────────────────────────────────────────────────

    const hrule = '═'.repeat(62);
    console.log('');
    console.log(hrule);
    console.log('  NOW DO THIS MANUALLY (from the CLIENT account)');
    console.log(hrule);
    console.log('');

    if (!sharedProgrammatically) {
      console.log(`  ⚠ First, share the file manually:`);
      console.log(`    drive.google.com → find fileId ${fileId} → Share`);
      console.log(`    → add ${clientEmail} as Editor → Done`);
      console.log('');
    }

    console.log(`  Sign in as ${clientEmail} at drive.google.com`);
    console.log(`  Find "clientedit-test.txt" in "Shared with me"`);
    console.log(`  Direct URL: https://drive.google.com/file/d/${fileId}/view`);
    console.log('');
    console.log('  Edit the FILE CONTENTS — do not rename:');
    console.log('');
    console.log('  1. Right-click "clientedit-test.txt" → "Manage versions"');
    console.log('     → "Upload new version"');
    console.log('  2. Upload any text file with at least one changed line');
    console.log('     (download the original, add a line of text, save, re-upload)');
    console.log('  3. Confirm the file name stays "clientedit-test.txt" — do NOT rename');
    console.log('');
    console.log('  The fileId stays the same; only the content changes.');
    console.log('  This mirrors the production workflow (client returns an edited xlsx).');
    console.log('');
    console.log('  Then save the values below and run Phase 2:');
    console.log('');
    console.log(`  TOKEN_FOR_PHASE2 = ${tokenForPhase2}`);
    console.log(`  FILE_ID          = ${fileId}`);
    console.log('');
    console.log('  Phase 2 command:');
    console.log(`  pnpm --filter @sprigly/worker verify-drive-clientedit \\`);
    console.log(`    ${slug} ${folderId} check ${tokenForPhase2} ${fileId}`);
    console.log('');
    console.log(hrule);

  } catch (err) {
    if (err instanceof AssertionError) {
      console.error(`\n✗ FAIL: ${err.message}`);
    } else {
      console.error(`\n✗ ERROR: ${String(err)}`);
    }
    if (fileId) {
      try { await drive.deleteFile(fileId); } catch { /* ignore cleanup error */ }
      console.log('  Cleanup: test file deleted.');
    }
    process.exit(1);
  }

  process.exit(0);
}

// ═════════════════════════════════════════════════════════════════════════════
// PHASE 2 — check
// ═════════════════════════════════════════════════════════════════════════════

if (phase === 'check') {
  const tokenBefore = process.argv[5];
  const fileId      = process.argv[6];

  if (!tokenBefore || !fileId) {
    console.error('Phase 2 requires: <TOKEN_FROM_PHASE1> <FILE_ID_FROM_PHASE1>');
    process.exit(1);
  }

  let passed = false;

  try {
    process.stdout.write('Step 1  changesList(TOKEN_FROM_PHASE1) ...\n');
    const { fileIds: changedIds } = await drive.changesList(tokenBefore);
    console.log(`        Changes since token: ${changedIds.length} file(s)`);
    if (changedIds.length > 0) {
      console.log(`        IDs: ${changedIds.join(', ')}`);
    }

    assert(
      changedIds.includes(fileId),
      `fileId ${fileId} NOT in changesList — ${changedIds.length} change(s) returned.\n` +
      `\n  FINDING: under drive.file scope, Drive does NOT surface changes made by\n` +
      `  other editors to app-created files in the file-creator's change feed.\n` +
      `  Stage 3's changesList poller cannot detect client edits with this scope.\n` +
      `  The polling strategy would need to shift to files.list (check modifiedTime\n` +
      `  on the file directly) rather than relying on the changes feed.`,
    );

    console.log('        ✓ fileId found — client edit IS visible in the change feed');
    passed = true;

  } catch (err) {
    if (err instanceof AssertionError) {
      console.error(`\n✗ FAIL: ${err.message}`);
    } else {
      console.error(`\n✗ ERROR: ${String(err)}`);
    }
  } finally {
    process.stdout.write(`Step 2  cleanup: deleteFile(${fileId}) ...\n`);
    try {
      await drive.deleteFile(fileId);
      console.log('        ✓ deleted');
    } catch (e) {
      console.warn(`        ⚠ cleanup failed — delete manually: ${fileId}`);
    }
  }

  if (passed) {
    console.log('\n✓ Client-edit verify PASS');
    console.log('  Client modifications surface in the file-creator\'s changesList.');
    console.log('  Stage 3 changesList poller is confirmed for the Sprigly-owned folder model.\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

// ── Unknown phase ─────────────────────────────────────────────────────────────

console.error(`Unknown phase '${phase}'. Expected 'setup' or 'check'.`);
process.exit(1);
