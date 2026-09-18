import { describe, expect, it } from 'vitest';
import { buildSensitiveKeyRedactPaths, isSensitiveKeyName } from './redaction.js';

describe('isSensitiveKeyName', () => {
  it.each([
    'authorization',
    'Authorization',
    'cookie',
    'set-cookie',
    'token',
    'password',
    'secret',
    'newPassword',
    'apiToken',
    'clientSecret',
  ])('flags %s as sensitive', (key) => {
    expect(isSensitiveKeyName(key)).toBe(true);
  });

  it.each(['email', 'id', 'name', 'jobId', 'attempt'])('leaves %s alone', (key) => {
    expect(isSensitiveKeyName(key)).toBe(false);
  });
});

describe('buildSensitiveKeyRedactPaths', () => {
  it('emits a bare and a wildcard path for each sensitive key name', () => {
    const paths = buildSensitiveKeyRedactPaths();
    expect(paths).toContain('password');
    expect(paths).toContain('*.password');
    expect(paths).toContain('authorization');
    expect(paths).toContain('*.cookie');
  });
});
