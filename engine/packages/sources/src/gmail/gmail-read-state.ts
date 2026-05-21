import { db as _db, gmailOperationErrors } from '@sprigly/db';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { GmailApiClient } from './gmail-client.js';

type Db = typeof _db;

/**
 * Creates a markRead function that can be injected into the consumer.
 * All errors are caught, logged to gmail_operation_errors, and swallowed —
 * a failed read-state flip must never re-fail a successfully-completed job.
 */
export function createGmailReadStateService(
  db: Db,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
) {
  return {
    async markRead(clientId: string, externalId: string): Promise<void> {
      const logError = async (errorMessage: string, errorCode?: string) => {
        try {
          await db.insert(gmailOperationErrors).values({
            clientId,
            operation: 'markAsRead',
            externalId,
            errorCode: errorCode ?? null,
            errorMessage,
          });
        } catch { /* db write failure must not cascade */ }
      };

      try {
        const tokens = await getTokens(db, encProvider, clientId, 'gmail');
        if (tokens === null) {
          await logError('No OAuth tokens found for client — mark-as-read skipped');
          return;
        }

        const client = new GmailApiClient(
          googleClientId,
          googleClientSecret,
          tokens,
          async (refreshed) => storeTokens(db, encProvider, clientId, 'gmail', refreshed),
          async (err) => {
            await logError(err.errorMessage, err.errorCode);
          },
        );

        // GmailApiClient.markAsRead already swallows errors internally via
        // onOperationError — this outer try-catch handles token-lookup failures.
        await client.markAsRead(externalId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await logError(message);
      }
    },
  };
}
