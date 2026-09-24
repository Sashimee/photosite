import { afterEach, describe, expect, it, vi } from 'vitest';

const buildSitemapMock = vi.fn();

vi.mock('@/lib/sitemap', () => ({ buildSitemap: buildSitemapMock }));

describe('sitemap route', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/env');
    buildSitemapMock.mockReset();
  });

  it('is empty when indexing is off, without ever calling the API-backed sources', async () => {
    vi.doMock('@/lib/env', () => ({ env: { NEXT_PUBLIC_ALLOW_INDEXING: false } }));
    const { default: sitemap } = await import('./sitemap');

    await expect(sitemap()).resolves.toEqual([]);
    expect(buildSitemapMock).not.toHaveBeenCalled();
  });

  it('returns the built sitemap when indexing is on', async () => {
    vi.doMock('@/lib/env', () => ({ env: { NEXT_PUBLIC_ALLOW_INDEXING: true } }));
    buildSitemapMock.mockResolvedValue([{ url: 'https://photoo.lu/en' }]);
    const { default: sitemap } = await import('./sitemap');

    await expect(sitemap()).resolves.toEqual([{ url: 'https://photoo.lu/en' }]);
  });
});
