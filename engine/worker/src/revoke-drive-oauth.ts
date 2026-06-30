/**
 * revoke-drive-oauth.ts — surgically revoke a single Drive refresh token.
 *
 * Calls Google's token revocation endpoint with the specific Drive refresh
 * token for the given client. Only that token is revoked — Gmail tokens for
 * any client are separate refresh tokens and are NOT affected.
 *
 * Use this instead of "Remove Access" on myaccount.google.com, which is the
 * blunt instrument that revokes ALL scopes for the app on that Google account.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker revoke-drive <client-slug>
 *
 * After running this:
 *   1. The Drive oauth_connections row for this client is deleted from the DB.
 *   2. The refresh token is invalid at Google — any in-flight access tokens
 *      derived from it will also stop working within minutes.
 *   3. Run setup-drive to re-consent at the corrected scope (drive.file).
 */

import { google } from 'googleapis';
import { db, clients, oauthConnections } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { getTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import { env } from './env.js';

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: pnpm --filter @sprigly/worker revoke-drive <client-slug>');
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
console.log(`Client: ${slug} (${clientId})`);

// ── Decrypt the stored Drive token ────────────────────────────────────────────

const encProvider = createEncryptionProvider();
const tokens = await getTokens(db, encProvider, clientId, 'drive');

if (!tokens) {
  console.error(`No Drive tokens found for '${slug}' — nothing to revoke.`);
  process.exit(1);
}

console.log(`Stored scopes: ${tokens.scopes.join(', ')}`);

if (!tokens.refreshToken) {
  console.error(
    'No refresh token in the stored bundle — cannot revoke.\n' +
    'Delete the DB row manually and re-run setup-drive.',
  );
  process.exit(1);
}

// ── Revoke the Drive refresh token via Google's revocation endpoint ───────────
// This revokes only this specific refresh token. Other refresh tokens for
// the same Google account (e.g. Gmail) are separate tokens and unaffected.

console.log('Revoking Drive refresh token at Google ...');

const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
try {
  await auth.revokeToken(tokens.refreshToken);
  console.log('✓ Token revoked at Google.');
} catch (err) {
  // A 400 "invalid_token" here means the token was already revoked or expired.
  // Either way, proceed to delete the DB row.
  console.warn(`  Warning: Google revoke call returned an error (${String(err)})`);
  console.warn('  Continuing — will still delete the DB row.');
}

// ── Delete the DB row ─────────────────────────────────────────────────────────

await db
  .delete(oauthConnections)
  .where(
    and(
      eq(oauthConnections.clientId, clientId),
      eq(oauthConnections.provider, 'drive'),
    ),
  );

console.log('✓ oauth_connections row deleted.');
console.log(`\nNext step: pnpm --filter @sprigly/worker setup-drive ${slug}`);
console.log('The consent screen will now show only drive.file scope.');
