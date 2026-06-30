import { db as _db, gmailOperationErrors } from '@sprigly/db';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider } from '@sprigly/oauth-tokens';
import { GmailApiClient } from './gmail-client.js';

type Db = typeof _db;
type WarnLogger = { warn(obj: Record<string, unknown>, msg: string): void };

export interface GmailDraftParams {
  threadId?: string;
  to: string;
  subject: string;
  bodyText: string;
  inReplyToMessageId?: string;
}

/**
 * Creates a draft service for creating, updating, and deleting Gmail drafts.
 * All errors are caught and logged to gmail_operation_errors — never rethrown.
 * createDraft returns null on failure; update/delete are fire-and-forget.
 */
export function createGmailDraftService(
  db: Db,
  encProvider: EncryptionProvider,
  googleClientId: string,
  googleClientSecret: string,
  logger?: WarnLogger,
) {
  const buildClient = async (clientId: string): Promise<GmailApiClient | null> => {
    const tokens = await getTokens(db, encProvider, clientId, 'gmail');
    if (tokens === null) return null;

    return new GmailApiClient(
      googleClientId,
      googleClientSecret,
      tokens,
      async (refreshed) => {
        try {
          await storeTokens(db, encProvider, clientId, 'gmail', refreshed);
        } catch (err) {
          logger?.warn({ clientId, err }, 'gmail: token refresh write-back failed — will self-heal on next call');
        }
      },
      async (err) => {
        try {
          await db.insert(gmailOperationErrors).values({
            clientId,
            operation: err.operation,
            externalId: err.externalId ?? null,
            errorCode: err.errorCode ?? null,
            errorMessage: err.errorMessage,
          });
        } catch { /* db write failure must not cascade */ }
      },
    );
  };

  return {
    async createDraft(clientId: string, params: GmailDraftParams): Promise<string | null> {
      try {
        const client = await buildClient(clientId);
        if (client === null) return null;
        const { draftId } = await client.createDraft(params);
        return draftId !== '' ? draftId : null;
      } catch {
        return null;
      }
    },

    async updateDraft(clientId: string, draftId: string, params: GmailDraftParams): Promise<void> {
      try {
        const client = await buildClient(clientId);
        if (client === null) return;
        await client.updateDraft(draftId, params);
      } catch { /* errors logged inside GmailApiClient.reportError */ }
    },

    async deleteDraft(clientId: string, draftId: string): Promise<void> {
      try {
        const client = await buildClient(clientId);
        if (client === null) return;
        await client.deleteDraft(draftId);
      } catch { /* errors logged inside GmailApiClient.reportError */ }
    },

    async applyLabel(clientId: string, threadId: string, labelName: string): Promise<void> {
      try {
        const client = await buildClient(clientId);
        if (client === null) return;
        await client.applyLabel(threadId, labelName);
      } catch { /* errors logged inside GmailApiClient.reportError */ }
    },
  };
}

export type GmailDraftService = ReturnType<typeof createGmailDraftService>;
