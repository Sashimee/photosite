import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptAesGcm, encryptAesGcm } from './aes-gcm.js';

describe('encryptAesGcm / decryptAesGcm', () => {
  const key = randomBytes(32);

  it('round-trips a plaintext value', () => {
    const ciphertext = encryptAesGcm('super-secret-totp-seed', key);
    expect(decryptAesGcm(ciphertext, key)).toBe('super-secret-totp-seed');
  });

  it('never leaks the plaintext in the ciphertext', () => {
    const ciphertext = encryptAesGcm('super-secret-totp-seed', key);
    expect(ciphertext).not.toContain('super-secret-totp-seed');
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const first = encryptAesGcm('same-value', key);
    const second = encryptAesGcm('same-value', key);
    expect(first).not.toBe(second);
  });

  it('fails to decrypt with the wrong key', () => {
    const ciphertext = encryptAesGcm('super-secret', key);
    const wrongKey = randomBytes(32);
    expect(() => decryptAesGcm(ciphertext, wrongKey)).toThrow();
  });

  it('fails to decrypt a tampered payload', () => {
    const ciphertext = encryptAesGcm('super-secret', key);
    const parts = ciphertext.split('.');
    const tampered = [parts[0], parts[1], `${parts[2]?.slice(0, -2) ?? ''}AA`].join('.');
    expect(() => decryptAesGcm(tampered, key)).toThrow();
  });

  it('rejects a malformed payload', () => {
    expect(() => decryptAesGcm('not-a-valid-payload', key)).toThrow(/malformed/);
  });
});
