import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db, clientChannels } from '@sprigly/db';
import { DriveApiClient } from '@sprigly/sources';
import { getTokens, storeTokens, createEncryptionProvider } from '@sprigly/oauth-tokens';

/**
 * Shared Drive access for the ingest core. Builds a DriveApiClient for a client's
 * channel folder (tokens + refresh write-back), mirroring ig-producer.ts. Lives in
 * admin/src/lib for now; promote to a @sprigly/ingest package when app/ reuses it.
 */
export async function getChannelDrive(
  clientId: string,
  channel: string,
): Promise<{ drive: DriveApiClient; driveFolderId: string } | { error: string }> {
  const enc = createEncryptionProvider();
  const tokens = await getTokens(db, enc, clientId, 'drive');
  if (!tokens) return { error: 'No Drive connection for this client — connect Drive in Mailboxes first.' };

  const [row] = await db
    .select({ driveFolderId: clientChannels.driveFolderId })
    .from(clientChannels)
    .where(and(eq(clientChannels.clientId, clientId), eq(clientChannels.channel, channel)))
    .limit(1);
  if (!row?.driveFolderId) return { error: 'No Drive folder configured for this channel.' };

  const drive = new DriveApiClient(
    process.env.GOOGLE_CLIENT_ID ?? '',
    process.env.GOOGLE_CLIENT_SECRET ?? '',
    tokens,
    async (t) => { try { await storeTokens(db, enc, clientId, 'drive', t); } catch { /* self-heals next call */ } },
  );
  return { drive, driveFolderId: row.driveFolderId };
}

/** Update-or-create a file by (case-insensitive) name in the folder — the idempotent
 *  pattern the pipeline uses (ig-producer.ts:169-183). */
export async function upsertDriveFile(
  drive: DriveApiClient,
  folderId: string,
  filename: string,
  mimeType: string,
  content: Buffer,
): Promise<'updated' | 'created'> {
  const files = await drive.listFiles(folderId);
  const existing = files.find((f) => f.name.toLowerCase() === filename.toLowerCase());
  if (existing) { await drive.updateFile(existing.id, mimeType, content); return 'updated'; }
  await drive.createFile(folderId, filename, mimeType, content);
  return 'created';
}
