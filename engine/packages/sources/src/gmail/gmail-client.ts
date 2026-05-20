import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import type { OAuthTokenBundle } from '@sprigly/oauth-tokens';

export interface GmailOperationErrorParams {
  operation: string;
  externalId?: string;
  errorCode?: string;
  errorMessage: string;
}

export class GmailApiClient {
  private gmail: gmail_v1.Gmail;
  private currentTokens: OAuthTokenBundle;

  constructor(
    googleClientId: string,
    googleClientSecret: string,
    tokens: OAuthTokenBundle,
    onTokensRefreshed: (tokens: OAuthTokenBundle) => Promise<void>,
    private onOperationError?: (err: GmailOperationErrorParams) => Promise<void>,
  ) {
    this.currentTokens = tokens;

    const auth = new google.auth.OAuth2(googleClientId, googleClientSecret);
    auth.setCredentials({
      access_token: tokens.accessToken,
      ...(tokens.refreshToken !== undefined && { refresh_token: tokens.refreshToken }),
      ...(tokens.expiresAt !== undefined && { expiry_date: tokens.expiresAt }),
    });

    auth.on('tokens', (newTokens) => {
      const newRefreshToken =
        typeof newTokens.refresh_token === 'string' ? newTokens.refresh_token : undefined;
      const refreshed: OAuthTokenBundle = {
        accessToken: newTokens.access_token ?? this.currentTokens.accessToken,
        scopes: this.currentTokens.scopes,
        ...(newRefreshToken !== undefined
          ? { refreshToken: newRefreshToken }
          : this.currentTokens.refreshToken !== undefined
            ? { refreshToken: this.currentTokens.refreshToken }
            : {}),
        ...(newTokens.expiry_date != null && { expiresAt: newTokens.expiry_date }),
        ...(this.currentTokens.emailAddress !== undefined && {
          emailAddress: this.currentTokens.emailAddress,
        }),
      };
      this.currentTokens = refreshed;
      void onTokensRefreshed(refreshed);
    });

    this.gmail = google.gmail({ version: 'v1', auth });
  }

  async listMessageIds(watermark: Date | null, maxResults = 50): Promise<string[]> {
    // Null watermark means the poller should have already returned early (see
    // GmailPoller.poll). Return nothing as a safe fallback so a missed guard
    // does not replay inbox history.
    if (watermark === null) return [];
    const q = `in:inbox after:${Math.floor(watermark.getTime() / 1000)}`;
    const res = await this.gmail.users.messages.list({ userId: 'me', q, maxResults });
    return (res.data.messages ?? [])
      .map((m) => m.id ?? '')
      .filter((id) => id !== '');
  }

  async getProfileEmailAddress(): Promise<string | null> {
    try {
      const res = await this.gmail.users.getProfile({ userId: 'me' });
      return res.data.emailAddress ?? null;
    } catch {
      return null;
    }
  }

  async getMessage(messageId: string): Promise<gmail_v1.Schema$Message> {
    const res = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    return res.data;
  }

async markAsRead(messageId: string): Promise<void> {
    try {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    } catch (err) {
      const e = err as Error & { code?: unknown };
      await this.reportError({
        operation: 'markAsRead',
        externalId: messageId,
        ...(e.code !== undefined && { errorCode: String(e.code) }),
        errorMessage: e.message,
      });
    }
  }

  /**
   * Creates a Gmail draft. bodyText is sent as-is in a text/plain MIME part —
   * no markdown conversion is applied. Rename or post-process before calling
   * if you need HTML output.
   */
  async createDraft(params: {
    threadId?: string;
    to: string;
    subject: string;
    bodyText: string;
    inReplyToMessageId?: string;
  }): Promise<{ draftId: string; messageId: string }> {
    const { threadId, to, subject, bodyText: bodyMarkdown, inReplyToMessageId } = params;

    const lines: string[] = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
    ];

    if (inReplyToMessageId !== undefined) {
      lines.push(`In-Reply-To: <${inReplyToMessageId}>`);
      lines.push(`References: <${inReplyToMessageId}>`);
    }

    lines.push('');
    lines.push(bodyMarkdown);

    const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

    try {
      const res = await this.gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            raw,
            ...(threadId !== undefined && { threadId }),
          },
        },
      });

      return {
        draftId: res.data.id ?? '',
        messageId: res.data.message?.id ?? '',
      };
    } catch (err) {
      const e = err as Error & { code?: unknown };
      await this.reportError({
        operation: 'createDraft',
        ...(e.code !== undefined && { errorCode: String(e.code) }),
        errorMessage: e.message,
      });
      return { draftId: '', messageId: '' };
    }
  }

  private async reportError(params: GmailOperationErrorParams): Promise<void> {
    if (this.onOperationError === undefined) return;
    try {
      await this.onOperationError(params);
    } catch {
      // callback failure must not cascade to the caller
    }
  }
}
