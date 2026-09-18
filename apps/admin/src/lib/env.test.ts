import { afterEach, describe, expect, it, vi } from 'vitest';

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
