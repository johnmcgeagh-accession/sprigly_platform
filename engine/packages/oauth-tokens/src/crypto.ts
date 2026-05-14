import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;

export function encrypt(plaintext: Buffer, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new Error('Key must be 32 bytes');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decrypt(encoded: string, key: Buffer): Buffer {
  if (key.length !== KEY_BYTES) throw new Error('Key must be 32 bytes');
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const authTag = buf.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
