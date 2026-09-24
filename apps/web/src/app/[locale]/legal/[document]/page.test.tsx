import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { getMessages } from '@photoo/i18n';

vi.mock('next-intl/server', () => ({
  getTranslations: ({ namespace }: { namespace: string }) => {
    const table = namespace
      .split('.')
      .reduce<Record<string, unknown>>(
        (acc, key) => (acc[key] ?? {}) as Record<string, unknown>,
        getMessages('en') as unknown as Record<string, unknown>,
      );
    return Promise.resolve((key: string) =>
      key
        .split('.')
        .reduce<unknown>(
          (acc, part) => (acc as Record<string, unknown> | undefined)?.[part],
          table,
        ),
    );
  },
}));

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({ notFound }));

async function renderPage(locale: string, document: string) {
  const { default: LegalDocumentPage } = await import('./page');
  const ui = await LegalDocumentPage({ params: Promise.resolve({ locale, document }) });
  render(ui);
}

describe('LegalDocumentPage', () => {
  it('renders each document against the real en catalog', async () => {
    for (const [document, title] of [
      ['imprint', 'Imprint'],
      ['privacy', 'Privacy policy'],
      ['terms', 'Terms of service'],
      ['cookies', 'Cookie policy'],
    ] as const) {
      cleanup();
      await renderPage('en', document);
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      screen.getByText(/being prepared/i);
    }
  });

  it('404s an unknown document instead of rendering an empty page', async () => {
    await expect(renderPage('en', 'not-a-document')).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('keeps placeholder text out of the index', async () => {
    const { generateMetadata } = await import('./page');
    const meta = await generateMetadata({
      params: Promise.resolve({ locale: 'en', document: 'privacy' }),
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it('still carries a canonical and full hreflang set despite being noindex', async () => {
    const { generateMetadata } = await import('./page');
    const meta = await generateMetadata({
      params: Promise.resolve({ locale: 'en', document: 'privacy' }),
    });
    expect(meta.alternates?.canonical).toBe('http://127.0.0.1:3000/en/legal/privacy');
    expect(meta.alternates?.languages).toMatchObject({
      en: 'http://127.0.0.1:3000/en/legal/privacy',
      fr: 'http://127.0.0.1:3000/fr/legal/privacy',
      'x-default': 'http://127.0.0.1:3000/en/legal/privacy',
    });
  });
});
