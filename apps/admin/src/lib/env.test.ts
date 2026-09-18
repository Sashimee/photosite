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

  it('treats an empty ADMIN_BASE_PATH as unset', async () => {
    const env = await loadEnv({ ADMIN_BASE_PATH: '' });
    expect(env.ADMIN_BASE_PATH).toBeUndefined();
  });

  it('keeps a configured ADMIN_BASE_PATH', async () => {
    const env = await loadEnv({ ADMIN_BASE_PATH: '/admin' });
    expect(env.ADMIN_BASE_PATH).toBe('/admin');
  });

  it('requires an API URL', async () => {
    await expect(loadEnv({ NEXT_PUBLIC_API_URL: '' })).rejects.toThrow(/NEXT_PUBLIC_API_URL/);
  });

  it('rejects a malformed API URL', async () => {
    await expect(loadEnv({ NEXT_PUBLIC_API_URL: 'not a url' })).rejects.toThrow(
      /NEXT_PUBLIC_API_URL/,
    );
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

  it('reads NEXT_PUBLIC_API_URL as a literal reference', () => {
    expect(source).toContain('process.env.NEXT_PUBLIC_API_URL');
  });
});
