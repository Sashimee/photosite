import type { Metadata } from 'next';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));

interface AuthEntryPageModule {
  generateMetadata: (args: { params: Promise<{ locale: string }> }) => Promise<Metadata>;
}

async function loadGenerateMetadata(module: string) {
  const mod = (await import(module)) as AuthEntryPageModule;
  return mod.generateMetadata;
}

// Sign-in, sign-up, two-factor, reset/forgot-password and verify-email are
// public entry points (not gated by `if (!user)`, so
// `private-routes-noindex.test.ts` doesn't see them) but have no content
// unique to a visitor and duplicate across every locale, so 1B.11 opts them
// out of the organic index the same way as any other thin page - while
// still giving each a stable canonical + hreflang set, since sign-up in
// particular is where ads campaigns land visitors and the URL must stay
// stable for UTM tracking regardless of indexing status.
const AUTH_ENTRY_PAGES = [
  { module: './sign-in/page', path: '/sign-in' },
  { module: './sign-in/two-factor/page', path: '/sign-in/two-factor' },
  { module: './sign-up/page', path: '/sign-up' },
  { module: './reset-password/page', path: '/reset-password' },
  { module: './forgot-password/page', path: '/forgot-password' },
  { module: './verify-email/page', path: '/verify-email' },
] as const;

describe.each(AUTH_ENTRY_PAGES)('$module generateMetadata', ({ module, path }) => {
  it('is noindex regardless of the site-wide indexing flag', async () => {
    const generateMetadata = await loadGenerateMetadata(module);
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) });
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('has exactly one canonical, pointing at the requested locale', async () => {
    const generateMetadata = await loadGenerateMetadata(module);
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'fr' }) });
    expect(metadata.alternates?.canonical).toBe(`http://127.0.0.1:3000/fr${path}`);
  });

  it('lists a reciprocal hreflang set including x-default', async () => {
    const generateMetadata = await loadGenerateMetadata(module);
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'en' }) });
    expect(metadata.alternates?.languages).toEqual({
      en: `http://127.0.0.1:3000/en${path}`,
      fr: `http://127.0.0.1:3000/fr${path}`,
      de: `http://127.0.0.1:3000/de${path}`,
      pt: `http://127.0.0.1:3000/pt${path}`,
      es: `http://127.0.0.1:3000/es${path}`,
      'x-default': `http://127.0.0.1:3000/en${path}`,
    });
  });
});
