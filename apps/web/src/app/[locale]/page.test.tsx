import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

describe('generateMetadata (home page)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('is indexable, with a canonical and full hreflang set, when indexing is allowed', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'true');
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) });

    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBe('http://127.0.0.1:3000/en');
    expect(metadata.alternates?.languages).toEqual({
      en: 'http://127.0.0.1:3000/en',
      fr: 'http://127.0.0.1:3000/fr',
      de: 'http://127.0.0.1:3000/de',
      pt: 'http://127.0.0.1:3000/pt',
      es: 'http://127.0.0.1:3000/es',
      'x-default': 'http://127.0.0.1:3000/en',
    });
  });

  it('is noindex when indexing is disallowed', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'false');
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) });

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('resolves the canonical for the requested locale, not just en', async () => {
    vi.stubEnv('NEXT_PUBLIC_ALLOW_INDEXING', 'true');
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'fr' }) });

    expect(metadata.alternates?.canonical).toBe('http://127.0.0.1:3000/fr');
  });

  it('returns empty metadata for an unsupported locale', async () => {
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'zz' }) });

    expect(metadata).toEqual({});
  });
});
