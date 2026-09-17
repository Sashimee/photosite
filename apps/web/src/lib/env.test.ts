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

  it('treats empty optional variables as unset', async () => {
    const env = await loadEnv({
      NEXT_PUBLIC_SENTRY_DSN: '',
      SENTRY_REQUIRED: '',
      NEXT_PUBLIC_MEDIA_BASE_URL: '',
    });

    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
    expect(env.SENTRY_REQUIRED).toBeUndefined();
    expect(env.NEXT_PUBLIC_MEDIA_BASE_URL).toBeUndefined();
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
