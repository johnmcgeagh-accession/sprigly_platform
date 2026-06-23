import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';
import { db as _db, clients, oauthConnections } from '@sprigly/db';
import { eq, and } from 'drizzle-orm';
import { getTokens, storeTokens } from '@sprigly/oauth-tokens';
import type { EncryptionProvider, OAuthTokenBundle } from '@sprigly/oauth-tokens';
import type { Destination, DestinationConfig, DeliveryResult, DeliveryContext, IncomingEvent } from '@sprigly/engine';
import { substituteTemplate } from './template.js';

type Db = typeof _db;

export interface GmailReplyWithAttachmentSettings {
  to:
    | { mode: 'sender' }
    | { mode: 'address'; address: string }
    | { mode: 'verified-domain-gate'; fallbackToClient?: boolean };
  subjectTemplate: string;
  bodyTemplate: string;
  attachmentFilenameTemplate: string;
  attachmentMimeType?: string;
  bodyMimeType?: 'text/html' | 'text/plain';
  /** Key in the workflow output object that holds the attachment Buffer.
   *  Defaults to 'pdf' so all existing callers are unaffected.
   *  Set to 'xlsx' for content-calendar delivery. */
  attachmentDataKey?: string;
}

/** Resolve the attachment buffer from a workflow output object by key.
 *  Returns null if the key is missing or the value is not a Buffer.
 *  Exported for unit-testing only — callers use deliver(). */
export function resolveAttachmentBuffer(
  output: Record<string, unknown>,
  key: string,
): Buffer | null {
  const val = output[key];
  return Buffer.isBuffer(val) ? val : null;
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

function extractEmailDomain(address: string): string {
  const emailMatch = address.match(/<([^>]+)>/) ?? address.match(/([^\s]+@[^\s]+)/);
  const email = emailMatch?.[1] ?? '';
  return email.split('@')[1]?.toLowerCase() ?? '';
}

// SAFETY: this workflow produces a dossier ABOUT the inbound party.
// The verified-domain-gate mode is the delivery safety mechanism — it lives
// here in the destination so protection travels with the workflow regardless
// of caller. FAIL-SAFE CONTRACT: every failure/missing-data path resolves to
// the client's on-file address; the function never defaults open to the sender.
// Any new caller that uses this destination with mode:'verified-domain-gate'
// must set event.reply.data['from'] to the real inbound sender's address so
// the domain comparison is meaningful.
async function resolveRecipient(
  settings: GmailReplyWithAttachmentSettings,
  event: IncomingEvent,
  db: Db,
): Promise<string | undefined> {
  if (settings.to.mode === 'sender') {
    return event.reply.data['from'] as string | undefined;
  }
  if (settings.to.mode === 'address') {
    return settings.to.address;
  }

  // verified-domain-gate ────────────────────────────────────────────────────
  // Fail-safe on every branch: if anything is missing or throws, we return the
  // client's on-file address. Returning undefined is also safe (delivery fails
  // with an error rather than leaking to the sender).
  try {
    const senderAddress = (event.reply.data['from'] as string | undefined) ?? '';
    const senderDomain  = extractEmailDomain(senderAddress);

    const [clientRows, connRows] = await Promise.all([
      db
        .select({ verifiedDomain: clients.verifiedDomain })
        .from(clients)
        .where(eq(clients.id, event.clientId))
        .limit(1),
      db
        .select({ emailAddress: oauthConnections.emailAddress })
        .from(oauthConnections)
        .where(
          and(
            eq(oauthConnections.clientId, event.clientId),
            eq(oauthConnections.provider, 'gmail'),
            eq(oauthConnections.status, 'active'),
          ),
        )
        .limit(1),
    ]);

    const verifiedDomain = clientRows[0]?.verifiedDomain?.toLowerCase() ?? '';
    const clientOnFile   = connRows[0]?.emailAddress ?? '';

    // Gate: all three conditions must hold to deliver to the sender.
    // Empty verifiedDomain → no gate configured → always falls through to client.
    // Empty senderDomain (parse failure) → same.
    if (verifiedDomain !== '' && senderDomain !== '' && senderDomain === verifiedDomain) {
      return senderAddress;  // same-domain colleague
    }

    // No match, or gate not configured, or parse failure → client's address.
    // If clientOnFile is also empty the delivery hard-fails (returns undefined)
    // rather than silently leaking to the sender.
    return clientOnFile || undefined;
  } catch {
    // DB error: hard-fail rather than default open to the sender.
    return undefined;
  }
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
      const settings = config.settings as unknown as GmailReplyWithAttachmentSettings;
      const attachmentKey = settings.attachmentDataKey ?? 'pdf';
      const attachmentBuf = resolveAttachmentBuffer(o, attachmentKey);
      if (!attachmentBuf) {
        return { success: false, error: `Output missing buffer at key '${attachmentKey}'` };
      }

      const toEmail = await resolveRecipient(settings, event, this.db);
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
        attachmentData: attachmentBuf,
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
