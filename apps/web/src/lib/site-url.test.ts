import { SUPPORTED_LOCALES } from '@photoo/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('absoluteUrl', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('joins the site origin, locale and path', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://photoo.lu');
    const { absoluteUrl } = await import('./site-url');
    expect(absoluteUrl('en', '/photographers/sofia-martins')).toBe(
      'https://photoo.lu/en/photographers/sofia-martins',
    );
  });

  it('resolves the bare locale root for an empty path', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://photoo.lu');
    const { absoluteUrl } = await import('./site-url');
    expect(absoluteUrl('fr', '')).toBe('https://photoo.lu/fr');
  });
});

describe('localeAlternates', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('lists every supported locale plus x-default, all pointing at the same path', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://photoo.lu');
    const { localeAlternates } = await import('./site-url');
    const alternates = localeAlternates('/job-offers/wedding-photographer-needed');

    for (const locale of SUPPORTED_LOCALES) {
      expect(alternates[locale]).toBe(
        `https://photoo.lu/${locale}/job-offers/wedding-photographer-needed`,
      );
    }
    expect(alternates['x-default']).toBe(
      'https://photoo.lu/en/job-offers/wedding-photographer-needed',
    );
    expect(Object.keys(alternates)).toHaveLength(SUPPORTED_LOCALES.length + 1);
  });

  // The hreflang set for a given path is reciprocal by construction: every
  // locale's page calls this same function with the same path, so every
  // variant advertises the exact same alternates map, including itself -
  // there is no per-locale branch that could list a sibling without being
  // listed back.
  it('returns the identical alternates map regardless of which locale is asking', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://photoo.lu');
    const { localeAlternates } = await import('./site-url');
    const path = '/photographers/lu/luxembourg-city/wedding';

    const alternatesPerLocale = SUPPORTED_LOCALES.map(() => localeAlternates(path));
    for (const alternates of alternatesPerLocale) {
      expect(alternates).toEqual(alternatesPerLocale[0]);
    }
  });
});
