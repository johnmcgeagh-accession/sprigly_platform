export type OAuthProvider = 'gmail' | 'outlook' | 'slack';

export interface OAuthTokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
  emailAddress?: string;
  raw?: Record<string, unknown>;
}

export interface EncryptionProvider {
  generateDataKey(
    context: Record<string, string>,
  ): Promise<{ plaintext: Buffer; encrypted: string }>;
  decryptDataKey(encryptedKey: string, context: Record<string, string>): Promise<Buffer>;
}
