import { Readable } from 'node:stream';
import { google } from 'googleapis';
import type { drive_v3 } from 'googleapis';
import type { OAuthTokenBundle } from '@sprigly/oauth-tokens';

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
}

export class DriveApiClient {
  private drive: drive_v3.Drive;
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
      };
      this.currentTokens = refreshed;
      void onTokensRefreshed(refreshed);
    });

    this.drive = google.drive({ version: 'v3', auth });
  }

  /** List files in a folder, optionally filtered by MIME type. */
  async listFiles(folderId: string, mimeType?: string): Promise<DriveFileMeta[]> {
    const q = mimeType
      ? `'${folderId}' in parents and mimeType='${mimeType}' and trashed=false`
      : `'${folderId}' in parents and trashed=false`;

    const res = await this.drive.files.list({
      q,
      fields: 'files(id,name,mimeType,modifiedTime,size)',
      orderBy: 'modifiedTime desc',
      pageSize: 100,
    });

    return (res.data.files ?? []).map((f) => ({
      id: f.id ?? '',
      name: f.name ?? '',
      mimeType: f.mimeType ?? '',
      modifiedTime: f.modifiedTime ?? '',
      ...(f.size !== undefined && f.size !== null && { size: f.size }),
    }));
  }

  /** Get metadata for a single file without downloading its content. */
  async getFileMetadata(fileId: string): Promise<DriveFileMeta> {
    const res = await this.drive.files.get({
      fileId,
      fields: 'id,name,mimeType,modifiedTime,size',
    });
    return {
      id: res.data.id ?? '',
      name: res.data.name ?? '',
      mimeType: res.data.mimeType ?? '',
      modifiedTime: res.data.modifiedTime ?? '',
      ...(res.data.size !== undefined && res.data.size !== null && { size: res.data.size }),
    };
  }

  /** Download a file's content and return it as a Buffer. */
  async downloadFile(fileId: string): Promise<Buffer> {
    const res = await this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(res.data as unknown as ArrayBuffer);
  }

  /** Upload a new file into a folder; returns the new file's Drive ID. */
  async uploadFile(
    folderId: string,
    name: string,
    mimeType: string,
    data: Buffer,
  ): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType, body: Readable.from(data) },
      fields: 'id',
    });
    return res.data.id ?? '';
  }

  /** Replace an existing file's content without changing its metadata or ID. */
  async updateFile(fileId: string, mimeType: string, data: Buffer): Promise<void> {
    await this.drive.files.update({
      fileId,
      media: { mimeType, body: Readable.from(data) },
    });
  }

  /** Create a new file in a folder; returns the new file's Drive ID.
   *  Alias for uploadFile with an explicit name that matches the stage-3 poll contract. */
  async createFile(
    folderId: string,
    name: string,
    mimeType: string,
    data: Buffer,
  ): Promise<string> {
    const res = await this.drive.files.create({
      requestBody: { name, parents: [folderId] },
      media: { mimeType, body: Readable.from(data) },
      fields: 'id',
    });
    return res.data.id ?? '';
  }

  /** Get metadata for a single file. Alias for getFileMetadata (cleaner name for callers). */
  async getFileMeta(fileId: string): Promise<DriveFileMeta> {
    return this.getFileMetadata(fileId);
  }

  /** Permanently delete a file. Use only for cleanup — moves to trash are not supported. */
  async deleteFile(fileId: string): Promise<void> {
    await this.drive.files.delete({ fileId });
  }

  /** Grant a user access to a file the app created.
   *  Works under drive.file scope for app-owned files.
   *  Throws if the file is not app-owned or scope is insufficient. */
  async shareFile(
    fileId: string,
    email: string,
    role: 'reader' | 'writer' | 'commenter' = 'writer',
  ): Promise<void> {
    await this.drive.permissions.create({
      fileId,
      requestBody: { role, type: 'user', emailAddress: email },
      sendNotificationEmail: false,
      fields: 'id',
    });
  }

  /** Return a page token representing the current head of the Drive changes feed.
   *  Capture this BEFORE making changes; pass it to changesList() to see only
   *  changes that occurred after this point. This is exactly Stage 3's poll anchor. */
  async getStartPageToken(): Promise<string> {
    const res = await this.drive.changes.getStartPageToken({});
    return res.data.startPageToken ?? '';
  }

  /** Return all file IDs that have changed since startPageToken, paging through
   *  the entire result set. Each fileId appears at most once (Drive deduplicates).
   *  With drive.file scope, only files the app created or opened are returned —
   *  that is intentional; the verify script tests this boundary explicitly. */
  async changesList(startPageToken: string): Promise<{ fileIds: string[]; nextPageToken: string }> {
    const seen = new Set<string>();
    let pageToken = startPageToken;

    for (;;) {
      const res = await this.drive.changes.list({
        pageToken,
        fields: 'changes(fileId,removed),newStartPageToken,nextPageToken',
        spaces: 'drive',
        includeItemsFromAllDrives: false,
        pageSize: 100,
      });

      for (const change of res.data.changes ?? []) {
        if (change.fileId) seen.add(change.fileId);
      }

      if (res.data.nextPageToken) {
        pageToken = res.data.nextPageToken;
      } else {
        return {
          fileIds: [...seen],
          nextPageToken: res.data.newStartPageToken ?? '',
        };
      }
    }
  }

  /** Returns the email address of the Drive account these tokens authorise. */
  async getAuthorizedEmail(): Promise<string | null> {
    try {
      const res = await this.drive.about.get({ fields: 'user' });
      return res.data.user?.emailAddress ?? null;
    } catch {
      return null;
    }
  }
}
