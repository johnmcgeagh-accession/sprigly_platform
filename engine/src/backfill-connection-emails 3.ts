#!/usr/bin/env tsx
/**
 * One-off backfill: populate email_address on oauth_connections rows where
 * it is currently NULL. Calls gmail.users.getProfile with each connection's
 * stored tokens to retrieve the authorised account's address.
 *
 * Safe to run multiple times — skips connections that already have an address.
 * Handles expired tokens: the Google OAuth2 client refreshes automatically;
 * if refresh fails the connection is logged and skipped.
 *
 * Usage:
 *   pnpm --filter @sprigly/worker backfill-emails
 */

import { db, oauthConnections } from '@sprigly/db';
import { eq, and, isNull } from 'drizzle-orm';
import { google } from 'googleapis';
import { getTokens, storeTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';
import type { OAuthTokenBundle } from '@sprigly/oauth-tokens';

const encProvider = createEncryptionProvider();

const rows = await db
  .select({ id: oauthConnections.id, clientId: oauthConnections.clientId })
  .from(oauthConnections)
  .where(
    and(
      eq(oauthConnections.provider, 'gmail'),
      eq(oauthConnections.status, 'active'),
      isNull(oauthConnections.emailAddress),
    ),
  );

if (rows.length === 0) {
  console.log('No connections missing email_address. Nothing to do.');
  process.exit(0);
}

console.log(`Found ${rows.length} connection(s) to backfill.\n`);

let updated = 0;
let skipped = 0;

for (const { id, clientId } of rows) {
  let tokens: OAuthTokenBundle | null;
  try {
    tokens = await getTokens(db, encProvider, clientId, 'gmail');
  } catch (err) {
    console.warn(`  SKIP ${clientId}: could not decrypt tokens — ${String(err)}`);
    skipped++;
    continue;
  }

  if (tokens === null) {
    console.warn(`  SKIP ${clientId}: no tokens stored`);
    skipped++;
    continue;
  }

  const auth = new google.auth.OAuth2(
    process.env['GOOGLE_CLIENT_ID'],
    process.env['GOOGLE_CLIENT_SECRET'],
  );
  auth.setCredentials({
    access_token:  tokens.accessToken,
    ...(tokens.refreshToken !== undefined && { refresh_token: tokens.refreshToken }),
    ...(tokens.expiresAt    !== undefined && { expiry_date:   tokens.expiresAt }),
  });

  // Persist refreshed tokens so the worker doesn't encounter stale credentials.
  auth.on('tokens', (newTokens) => {
    const refreshed: OAuthTokenBundle = {
      accessToken: newTokens.access_token ?? tokens!.accessToken,
      scopes: tokens!.scopes,
      ...(typeof newTokens.refresh_token === 'string'
        ? { refreshToken: newTokens.refresh_token }
        : tokens!.refreshToken !== undefined
          ? { refreshToken: tokens!.refreshToken }
          : {}),
      ...(newTokens.expiry_date != null && { expiresAt: newTokens.expiry_date }),
    };
    void storeTokens(db, encProvider, clientId, 'gmail', refreshed);
  });

  const gmail = google.gmail({ version: 'v1', auth });

  let emailAddress: string | undefined;
  try {
    const profile = await gmail.users.getProfile({ userId: 'me' });
    emailAddress = profile.data.emailAddress ?? undefined;
  } catch (err) {
    console.warn(`  SKIP ${clientId}: getProfile failed — ${String(err)}`);
    skipped++;
    continue;
  }

  if (emailAddress === undefined) {
    console.warn(`  SKIP ${clientId}: getProfile returned no emailAddress`);
    skipped++;
    continue;
  }

  await db
    .update(oauthConnections)
    .set({ emailAddress, updatedAt: new Date() })
    .where(eq(oauthConnections.id, id));

  console.log(`  OK ${clientId}: ${emailAddress}`);
  updated++;
}

console.log(`\nDone. ${updated} updated, ${skipped} skipped.`);
process.exit(0);
