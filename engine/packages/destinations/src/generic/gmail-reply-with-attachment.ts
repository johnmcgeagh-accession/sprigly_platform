import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { db as _db } from '@sprigly/db';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider, OAuthTokenBundle } from '@sprigly/oauth-tokens';
import type { Destination, DestinationConfig, DeliveryResult, DeliveryContext, IncomingEvent } from '@sprigly/engine';
import { substituteTemplate } from './template.js';

type Db = typeof _db;

export interface GmailReplyWithAttachmentSettings {
  to: { mode: 'sender' } | { mode: 'address'; address: string };
  subjectTemplate: string;
  bodyTemplate: string;
  attachmentFilenameTemplate: string;
  attachmentMimeType?: string;
  bodyMimeType?: 'text/html' | 'text/plain';
}

export function composeMimeWithAttachment(params: {
  toEmail: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
  attachmentData: Buffer;
  attachmentFilename: string;
  attachmentMimeType: string;
  bodyMimeType: 'text/html' | 'text/plain';
}): string {
  const { toEmail, fromEmail, subject, bodyText, attachmentData, attachmentFilename, attachmentMimeType, bodyMimeType } = params;
  const boundary = `----=_Part_${randomUUID().replace(/-/g, '')}`;
  const attachmentBase64 = attachmentData.toString('base64');

  return [
    `To: ${toEmail}`,
    `From: ${fromEmail}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    `Content-Type: ${bodyMimeType}; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    '',
    bodyText,
    '',
    `--${boundary}`,
    `Content-Type: ${attachmentMimeType}`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${attachmentFilename}"`,
    '',
    attachmentBase64,
    `--${boundary}--`,
  ].join('\r\n');
}

function resolveRecipient(settings: GmailReplyWithAttachmentSettings, event: IncomingEvent): string | undefined {
  if (settings.to.mode === 'sender') {
    return event.reply.data['from'] as string | undefined;
  }
  return settings.to.address;
}

export class GmailReplyWithAttachment implements Destination<unknown> {
  id = 'gmail-reply-with-attachment';

  constructor(
    private db: Db,
    private encProvider: EncryptionProvider,
    private googleClientId: string,
    private googleClientSecret: string,
  ) {}

  requiresApproval(config: DestinationConfig): boolean {
    return config.requireApproval === true;
  }

  async deliver(output: unknown, event: IncomingEvent, config: DestinationConfig, _ctx: DeliveryContext): Promise<DeliveryResult> {
    try {
      const o = output as Record<string, unknown>;
      if (!Buffer.isBuffer(o['pdf'])) {
        return { success: false, error: 'Output missing pdf buffer' };
      }
      const pdf = o['pdf'] as Buffer;

      const settings = config.settings as unknown as GmailReplyWithAttachmentSettings;
      const toEmail = resolveRecipient(settings, event);
      if (!toEmail) {
        return { success: false, error: 'Could not resolve recipient address' };
      }

      const subject = substituteTemplate(settings.subjectTemplate, o);
      const bodyText = substituteTemplate(settings.bodyTemplate, o).replace(/\r?\n/g, '\r\n');
      const rawFilename = substituteTemplate(settings.attachmentFilenameTemplate, o);
      const attachmentFilename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '-');
      const attachmentMimeType = settings.attachmentMimeType ?? 'application/pdf';
      const bodyMimeType = settings.bodyMimeType ?? 'text/plain';

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

      const raw = composeMimeWithAttachment({
        toEmail,
        fromEmail,
        subject,
        bodyText,
        attachmentData: pdf,
        attachmentFilename,
        attachmentMimeType,
        bodyMimeType,
      });
      const encodedMessage = Buffer.from(raw).toString('base64url');

      await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });

      return { success: true, metadata: { toEmail } };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}
