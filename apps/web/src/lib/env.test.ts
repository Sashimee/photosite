import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ENV_KEYS } from './env';

async function loadEnv(vars: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  return (await import('./env')).env;
}

describe('env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('treats empty optional variables as unset', async () => {
    const env = await loadEnv({
      NEXT_PUBLIC_SENTRY_DSN: '',
      SENTRY_REQUIRED: '',
      NEXT_PUBLIC_MEDIA_BASE_URL: '',
      NEXT_PUBLIC_STORAGE_ORIGIN: '',
    });

    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
    expect(env.SENTRY_REQUIRED).toBeUndefined();
    expect(env.NEXT_PUBLIC_MEDIA_BASE_URL).toBeUndefined();
    expect(env.NEXT_PUBLIC_STORAGE_ORIGIN).toBeUndefined();
  });

  it('requires a site URL', async () => {
    await expect(loadEnv({ NEXT_PUBLIC_SITE_URL: '' })).rejects.toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it('rejects a malformed site URL', async () => {
    await expect(loadEnv({ NEXT_PUBLIC_SITE_URL: 'not a url' })).rejects.toThrow(
      /NEXT_PUBLIC_SITE_URL/,
    );
  });

  it('rejects a malformed media base URL', async () => {
    await expect(loadEnv({ NEXT_PUBLIC_MEDIA_BASE_URL: 'not a url' })).rejects.toThrow(
      /NEXT_PUBLIC_MEDIA_BASE_URL/,
    );
  });

  it('rejects a malformed storage origin', async () => {
    await expect(loadEnv({ NEXT_PUBLIC_STORAGE_ORIGIN: 'not a url' })).rejects.toThrow(
      /NEXT_PUBLIC_STORAGE_ORIGIN/,
    );
  });

  it('rejects a malformed Sentry DSN', async () => {
    await expect(loadEnv({ NEXT_PUBLIC_SENTRY_DSN: 'not a url' })).rejects.toThrow(
      /NEXT_PUBLIC_SENTRY_DSN/,
    );
  });

  it('requires a Sentry DSN in production when SENTRY_REQUIRED is true', async () => {
    await expect(
      loadEnv({ NODE_ENV: 'production', SENTRY_REQUIRED: 'true', NEXT_PUBLIC_SENTRY_DSN: '' }),
    ).rejects.toThrow(/NEXT_PUBLIC_SENTRY_DSN is required/);
  });
});

// Guards the bug that took every data-driven page down on the preview: Next
// substitutes only *literal* `process.env.NEXT_PUBLIC_X` references into the
// client bundle, so `safeParse(process.env)` leaves them undefined in the
// browser and this module throws at evaluation. A runtime test cannot catch
// it - `process.env` works fine under vitest - so assert the shape of the
// source instead.
describe('client bundle inlining', () => {
  // vitest runs with the package root as cwd; import.meta.url is not a
  // file: URL under vite's transform, so resolve from the root instead.
  const source = readFileSync('src/lib/env.ts', 'utf8');

  it('does not hand the whole process.env object to the schema', () => {
    expect(source).not.toMatch(/safeParse\(\s*process\.env\s*\)/);
  });

  it.each(ENV_KEYS)('reads %s as a literal reference', (key) => {
    expect(source).toContain(`process.env.${key}`);
  });

  it('reads NEXT_PUBLIC_ALLOW_INDEXING as a literal reference', () => {
    expect(source).toContain('process.env.NEXT_PUBLIC_ALLOW_INDEXING');
  });
});
