import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt } from './crypto.js';

describe('AES-256-GCM round-trip', () => {
  it('decrypts to original plaintext', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('{"accessToken":"test123"}');
    const encoded = encrypt(plaintext, key);
    const result = decrypt(encoded, key);
    expect(result.toString()).toBe(plaintext.toString());
  });

  it('produces different ciphertext each call (random IV)', () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from('same content');
    expect(encrypt(plaintext, key)).not.toBe(encrypt(plaintext, key));
  });

  it('throws on wrong key', () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const encoded = encrypt(Buffer.from('secret'), key);
    expect(() => decrypt(encoded, wrongKey)).toThrow();
  });

  it('throws if key is not 32 bytes', () => {
    expect(() => encrypt(Buffer.from('x'), randomBytes(16))).toThrow('Key must be 32 bytes');
  });
});
