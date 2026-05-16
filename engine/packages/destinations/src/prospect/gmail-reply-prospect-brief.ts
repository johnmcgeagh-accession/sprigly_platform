import { google } from 'googleapis';
import { db as _db } from '@sprigly/db';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider, OAuthTokenBundle } from '@sprigly/oauth-tokens';
import type { Destination, DestinationConfig, DeliveryResult, IncomingEvent } from '@sprigly/engine';
import type { ProspectBriefData } from '@sprigly/pdf-render';
import { composeProspectEmail } from './compose-prospect-email.js';

type Db = typeof _db;

interface ProspectOutput {
  data: ProspectBriefData;
  pdf: Buffer;
}

function resolveToAddress(config: DestinationConfig, event: IncomingEvent): string | undefined {
  const to = config.settings['to'] as string | undefined;
  if (to === 'sender') return event.reply.data['from'] as string | undefined;
  return to;
}

export class GmailReplyProspectBrief implements Destination<unknown> {
  id = 'gmail-reply-prospect-brief';

  constructor(
    private db: Db,
    private encProvider: EncryptionProvider,
    private googleClientId: string,
    private googleClientSecret: string,
  ) {}

  requiresApproval(config: DestinationConfig): boolean {
    return config.requireApproval === true;
  }

  async deliver(output: unknown, event: IncomingEvent, config: DestinationConfig, _runId: string): Promise<DeliveryResult> {
    try {
      const o = output as ProspectOutput;
      if (!o.data || !Buffer.isBuffer(o.pdf)) {
        return { success: false, error: 'Output missing data or pdf fields' };
      }

      const toEmail = resolveToAddress(config, event);
      if (!toEmail) {
        return { success: false, error: 'Could not resolve recipient address' };
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

      const raw = composeProspectEmail({ toEmail, fromEmail, data: o.data, pdf: o.pdf });
      const encodedMessage = Buffer.from(raw).toString('base64url');

      await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });

      return { success: true, metadata: { toEmail, brandName: o.data.brandName } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
