import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import type { OAuthTokenBundle } from '@sprigly/oauth-tokens';

export class GmailApiClient {
  private gmail: gmail_v1.Gmail;
  private currentTokens: OAuthTokenBundle;

  constructor(
    googleClientId: string,
    googleClientSecret: string,
    tokens: OAuthTokenBundle,
    onTokensRefreshed: (tokens: OAuthTokenBundle) => Promise<void>,
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

  async listMessageIds(maxResults = 50): Promise<string[]> {
    const res = await this.gmail.users.messages.list({
      userId: 'me',
      q: 'in:inbox is:unread',
      maxResults,
    });
    return (res.data.messages ?? [])
      .map((m) => m.id ?? '')
      .filter((id) => id !== '');
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
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  }
}
