import { eq, and } from 'drizzle-orm';
import { db as _db, oauthConnections } from '@sprigly/db';
import type { OAuthProvider, OAuthTokenBundle, EncryptionProvider } from './types.js';
import { decrypt } from './crypto.js';

type Db = typeof _db;

export async function getTokens(
  db: Db,
  encProvider: EncryptionProvider,
  clientId: string,
  oauthProvider: OAuthProvider,
): Promise<OAuthTokenBundle | null> {
  const rows = await db
    .select()
    .from(oauthConnections)
    .where(
      and(
        eq(oauthConnections.clientId, clientId),
        eq(oauthConnections.provider, oauthProvider),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const context = { clientId, provider: oauthProvider };
  const dek = await encProvider.decryptDataKey(row.encryptedDataKey, context);
  const plaintext = decrypt(row.encryptedTokens, dek);
  return JSON.parse(plaintext.toString('utf8')) as OAuthTokenBundle;
}
