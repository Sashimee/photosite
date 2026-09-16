import { describe, expect, it } from 'vitest';

import { buildLocaleRedirectPath, pathnameHasLocale } from './locale-routing';

describe('pathnameHasLocale', () => {
  it('is true for an exact locale segment', () => {
    expect(pathnameHasLocale('/en')).toBe(true);
    expect(pathnameHasLocale('/fr')).toBe(true);
  });

  it('is true for a locale-prefixed path', () => {
    expect(pathnameHasLocale('/de/photographers')).toBe(true);
  });

  it('is false for the root or an unprefixed path', () => {
    expect(pathnameHasLocale('/')).toBe(false);
    expect(pathnameHasLocale('/photographers')).toBe(false);
  });

  it('is false for a locale-like prefix that is not supported', () => {
    expect(pathnameHasLocale('/it/photographers')).toBe(false);
  });
});

describe('buildLocaleRedirectPath', () => {
  it('returns null when the path already has a supported locale', () => {
    expect(buildLocaleRedirectPath('/en/photographers', '', 'fr-LU,fr;q=0.9')).toBeNull();
  });

  it('redirects the root to the resolved locale', () => {
    expect(buildLocaleRedirectPath('/', '', 'fr-LU,fr;q=0.9')).toBe('/fr');
  });

  it('preserves the requested path when redirecting', () => {
    expect(buildLocaleRedirectPath('/photographers', '', 'de-DE')).toBe('/de/photographers');
  });

  it('preserves the query string when redirecting', () => {
    expect(buildLocaleRedirectPath('/photographers', '?q=wedding', 'de-DE')).toBe(
      '/de/photographers?q=wedding',
    );
  });

  it('falls back to the default locale when accept-language is missing', () => {
    expect(buildLocaleRedirectPath('/', '', null)).toBe('/en');
  });

  it('falls back to the default locale for an unsupported language', () => {
    expect(buildLocaleRedirectPath('/', '', 'it-IT')).toBe('/en');
  });
});
