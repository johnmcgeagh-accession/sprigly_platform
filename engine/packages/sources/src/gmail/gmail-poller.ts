import { db as _db, incomingEvents, processedExternalIds } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { GmailApiClient } from './gmail-client.js';
import { extractMessageText, getHeader, parseReceivedAt } from './gmail-parser.js';

type Db = typeof _db;

export class GmailPoller {
  constructor(
    private db: Db,
    private encProvider: EncryptionProvider,
    private googleClientId: string,
    private googleClientSecret: string,
  ) {}

  async poll(clientId: string): Promise<number> {
    const tokens = await getTokens(this.db, this.encProvider, clientId, 'gmail');
    if (tokens === null) return 0;

    const client = new GmailApiClient(
      this.googleClientId,
      this.googleClientSecret,
      tokens,
      (refreshed) => storeTokens(this.db, this.encProvider, clientId, 'gmail', refreshed),
    );

    const messageIds = await client.listMessageIds();
    let count = 0;

    for (const messageId of messageIds) {
      const existing = await this.db
        .select({ id: processedExternalIds.id })
        .from(processedExternalIds)
        .where(
          and(
            eq(processedExternalIds.clientId, clientId),
            eq(processedExternalIds.source, 'gmail'),
            eq(processedExternalIds.externalId, messageId),
          ),
        )
        .limit(1);

      if (existing[0] !== undefined) {
        await client.markAsRead(messageId).catch(() => undefined);
        continue;
      }

      const message = await client.getMessage(messageId);
      const headers = message.payload?.headers ?? [];
      const text = extractMessageText(message);
      const subject = getHeader(headers, 'Subject');
      const from = getHeader(headers, 'From');
      const to = getHeader(headers, 'To');
      const date = getHeader(headers, 'Date');
      const receivedAt = parseReceivedAt(message);

      // Insert idempotency record before incoming_events (crash-safe ordering)
      await this.db.insert(processedExternalIds).values({
        clientId,
        source: 'gmail',
        externalId: messageId,
        processedAt: new Date(),
      });

      await this.db.insert(incomingEvents).values({
        clientId,
        source: 'email',
        sourceMetadata: {
          messageId,
          threadId: message.threadId ?? '',
          from,
          to,
          subject,
          date,
        },
        content: {
          text,
          structured: { subject },
        },
        receivedAt,
        status: 'received',
        externalId: messageId,
      });

      await client.markAsRead(messageId).catch(() => undefined);
      count++;
    }

    return count;
  }
}
