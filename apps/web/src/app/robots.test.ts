import { afterEach, describe, expect, it, vi } from 'vitest';

describe('robots route', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/env');
  });

  it('disallows everything when indexing is off', async () => {
    vi.doMock('@/lib/env', () => ({
      env: { NEXT_PUBLIC_ALLOW_INDEXING: false, NEXT_PUBLIC_SITE_URL: 'https://photoo.lu' },
    }));
    const { default: robots } = await import('./robots');
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });

  it('allows everything and points at the sitemap when indexing is on', async () => {
    vi.doMock('@/lib/env', () => ({
      env: { NEXT_PUBLIC_ALLOW_INDEXING: true, NEXT_PUBLIC_SITE_URL: 'https://photoo.lu' },
    }));
    const { default: robots } = await import('./robots');
    expect(robots()).toEqual({
      rules: { userAgent: '*', allow: '/' },
      sitemap: 'https://photoo.lu/sitemap.xml',
    });
  });
});
