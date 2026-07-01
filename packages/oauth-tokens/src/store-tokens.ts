import { eq, and } from 'drizzle-orm';
import { db as _db, oauthConnections } from '@sprigly/db';
import type { OAuthProvider, OAuthTokenBundle, EncryptionProvider } from './types.js';
import { encrypt } from './crypto.js';

type Db = typeof _db;

export async function storeTokens(
  db: Db,
  encProvider: EncryptionProvider,
  clientId: string,
  oauthProvider: OAuthProvider,
  tokens: OAuthTokenBundle,
): Promise<void> {
  const context = { clientId, provider: oauthProvider };
  const { plaintext: dek, encrypted: encryptedDataKey } =
    await encProvider.generateDataKey(context);
  const encryptedTokens = encrypt(Buffer.from(JSON.stringify(tokens)), dek);

  const existing = await db
    .select({ id: oauthConnections.id })
    .from(oauthConnections)
    .where(
      and(
        eq(oauthConnections.clientId, clientId),
        eq(oauthConnections.provider, oauthProvider),
      ),
    )
    .limit(1);

  const existingRow = existing[0];

  if (existingRow !== undefined) {
    await db
      .update(oauthConnections)
      .set({
        encryptedTokens,
        encryptedDataKey,
        scopes: tokens.scopes,
        emailAddress: tokens.emailAddress ?? null,
        status: 'active',
        // A successful store (reconnect or auto-refresh) means the token works now:
        // clear the error and mark healthy so a reconnected row leaves the storm.
        lastOkAt: new Date(),
        lastError: null,
        lastErrorAt: null,
        updatedAt: new Date(),
      })
      .where(eq(oauthConnections.id, existingRow.id));
  } else {
    await db.insert(oauthConnections).values({
      clientId,
      provider: oauthProvider,
      encryptedTokens,
      encryptedDataKey,
      scopes: tokens.scopes,
      emailAddress: tokens.emailAddress ?? null,
      status: 'active',
      lastOkAt: new Date(),
    });
  }
}
