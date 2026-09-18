import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBuildInfo(vars: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  return (await import('./build-info')).getBuildInfo;
}

describe('getBuildInfo', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to "dev" and no build time when unset', async () => {
    const getBuildInfo = await loadBuildInfo({
      NEXT_PUBLIC_BUILD_SHA: '',
      NEXT_PUBLIC_BUILD_TIME: '',
    });

    expect(getBuildInfo()).toEqual({ version: 'dev', builtAt: null });
  });

  it('reports the configured build sha and time', async () => {
    const getBuildInfo = await loadBuildInfo({
      NEXT_PUBLIC_BUILD_SHA: 'abc1234',
      NEXT_PUBLIC_BUILD_TIME: '2026-09-01T00:00:00.000Z',
    });

    expect(getBuildInfo()).toEqual({ version: 'abc1234', builtAt: '2026-09-01T00:00:00.000Z' });
  });
});
