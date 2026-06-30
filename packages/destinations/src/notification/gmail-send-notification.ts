import { google } from 'googleapis';
import { db as _db } from '@sprigly/db';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider, OAuthTokenBundle } from '@sprigly/oauth-tokens';
import type { Destination, DestinationConfig, DeliveryResult, DeliveryContext, IncomingEvent } from '@sprigly/engine';
import { composeOutputEmail, formatOutputAsText } from './compose-email.js';

type Db = typeof _db;

/**
 * Resolves the recipient address from a destination config.
 * settings.to = "sender"  →  the From address of the triggering event (event.reply.data['from']).
 * settings.to = <anything else>  →  used as a literal email address.
 */
function resolveToAddress(config: DestinationConfig, event: IncomingEvent): string | undefined {
  const to = config.settings['to'] as string | undefined;
  if (to === 'sender') {
    const from = event.reply.data['from'] as string | undefined;
    return from;
  }
  return to;
}

export class GmailSendNotification implements Destination<unknown> {
  id = 'gmail-send-notification';

  constructor(
    private db: Db,
    private encProvider: EncryptionProvider,
    private googleClientId: string,
    private googleClientSecret: string,
  ) {}

  requiresApproval(_config: DestinationConfig): boolean {
    return false;
  }

  async deliver(output: unknown, event: IncomingEvent, config: DestinationConfig, _ctx: DeliveryContext): Promise<DeliveryResult> {
    try {
      const toEmail = resolveToAddress(config, event);
      if (toEmail === undefined || toEmail === '') {
        return { success: false, error: 'Could not resolve recipient address (settings.to missing or sender address unavailable)' };
      }

      const tokens = await getTokens(this.db, this.encProvider, event.clientId, 'gmail');
      if (tokens === null) return { success: false, error: 'No Gmail tokens for client' };

      let currentTokens: OAuthTokenBundle = tokens;

      const auth = new google.auth.OAuth2(this.googleClientId, this.googleClientSecret);
      auth.setCredentials({
        access_token: tokens.accessToken,
        ...(tokens.refreshToken !== undefined && { refresh_token: tokens.refreshToken }),
        ...(tokens.expiresAt !== undefined && { expiry_date: tokens.expiresAt }),
      });

      auth.on('tokens', (newTokens) => {
        const newRefreshToken =
          typeof newTokens.refresh_token === 'string' ? newTokens.refresh_token : undefined;
        const refreshed: OAuthTokenBundle = {
          accessToken: newTokens.access_token ?? currentTokens.accessToken,
          scopes: currentTokens.scopes,
          ...(newRefreshToken !== undefined
            ? { refreshToken: newRefreshToken }
            : currentTokens.refreshToken !== undefined
              ? { refreshToken: currentTokens.refreshToken }
              : {}),
          ...(newTokens.expiry_date != null && { expiresAt: newTokens.expiry_date }),
          ...(currentTokens.emailAddress !== undefined && {
            emailAddress: currentTokens.emailAddress,
          }),
        };
        currentTokens = refreshed;
        void storeTokens(this.db, this.encProvider, event.clientId, 'gmail', refreshed);
      });

      const gmail = google.gmail({ version: 'v1', auth });
      const fromEmail = tokens.emailAddress ?? toEmail;

      const obj = output as Record<string, unknown> | null;
      const title = typeof obj?.['title'] === 'string' ? obj['title'] : 'Output ready';
      const workflowId = (event.sourceMetadata['workflowId'] as string | undefined) ?? '';

      const subject = config.settings['subject'] as string | undefined
        ?? `Output ready: ${title}`;

      const bodyText = formatOutputAsText(output);

      const raw = composeOutputEmail({ toEmail, fromEmail, workflowId, subject, bodyText });
      const encodedMessage = Buffer.from(raw).toString('base64url');

      await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });

      return { success: true, metadata: { toEmail } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
