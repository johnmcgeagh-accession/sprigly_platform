import { randomBytes } from 'node:crypto';
import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
import type { EncryptionProvider } from './types.js';
import { encrypt, decrypt } from './crypto.js';

export class KmsProvider implements EncryptionProvider {
  private client: KMSClient;
  private keyId: string;

  constructor(
    keyId: string,
    region: string,
    credentials?: { accessKeyId: string; secretAccessKey: string },
  ) {
    this.keyId = keyId;
    this.client = new KMSClient({
      region,
      ...(credentials !== undefined && { credentials }),
    });
  }

  async generateDataKey(
    context: Record<string, string>,
  ): Promise<{ plaintext: Buffer; encrypted: string }> {
    const result = await this.client.send(
      new GenerateDataKeyCommand({
        KeyId: this.keyId,
        KeySpec: 'AES_256',
        EncryptionContext: context,
      }),
    );
    if (!result.Plaintext || !result.CiphertextBlob) {
      throw new Error('KMS GenerateDataKey returned empty response');
    }
    return {
      plaintext: Buffer.from(result.Plaintext),
      encrypted: Buffer.from(result.CiphertextBlob).toString('base64'),
    };
  }

  async decryptDataKey(
    encryptedKey: string,
    context: Record<string, string>,
  ): Promise<Buffer> {
    const result = await this.client.send(
      new DecryptCommand({
        CiphertextBlob: Buffer.from(encryptedKey, 'base64'),
        EncryptionContext: context,
      }),
    );
    if (!result.Plaintext) {
      throw new Error('KMS Decrypt returned empty response');
    }
    return Buffer.from(result.Plaintext);
  }
}

export class LocalDevProvider implements EncryptionProvider {
  private masterKey: Buffer;

  constructor(masterKey: Buffer) {
    if (masterKey.length !== 32) throw new Error('LocalDevProvider: masterKey must be 32 bytes');
    this.masterKey = masterKey;
  }

  async generateDataKey(
    _context: Record<string, string>,
  ): Promise<{ plaintext: Buffer; encrypted: string }> {
    const dek = randomBytes(32);
    const encrypted = encrypt(dek, this.masterKey);
    return { plaintext: dek, encrypted };
  }

  async decryptDataKey(
    encryptedKey: string,
    _context: Record<string, string>,
  ): Promise<Buffer> {
    return decrypt(encryptedKey, this.masterKey);
  }
}

export function createEncryptionProvider(): EncryptionProvider {
  const kmsKeyId = process.env['AWS_KMS_KEY_ID'];
  if (kmsKeyId) {
    const region = process.env['AWS_REGION'] ?? 'eu-west-2';
    const accessKeyId = process.env['KMS_AWS_ACCESS_KEY_ID'];
    const secretAccessKey = process.env['KMS_AWS_SECRET_ACCESS_KEY'];

    if (!!accessKeyId !== !!secretAccessKey) {
      throw new Error(
        'KMS_AWS_ACCESS_KEY_ID and KMS_AWS_SECRET_ACCESS_KEY must both be set or both be absent ' +
        '— create a dedicated IAM user at: AWS Console → IAM → Users → Create user',
      );
    }

    const credentials =
      accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;

    return new KmsProvider(kmsKeyId, region, credentials);
  }

  const localKey = process.env['LOCAL_DEV_ENCRYPTION_KEY'];
  if (localKey) {
    console.warn('[oauth-tokens] Using LOCAL_DEV_ENCRYPTION_KEY — NOT suitable for production');
    const keyBuf = Buffer.from(localKey, 'base64');
    if (keyBuf.length !== 32) {
      throw new Error('LOCAL_DEV_ENCRYPTION_KEY must be 32 bytes when base64-decoded');
    }
    return new LocalDevProvider(keyBuf);
  }

  throw new Error(
    'oauth-tokens: set AWS_KMS_KEY_ID (production) or LOCAL_DEV_ENCRYPTION_KEY (development)',
  );
}
