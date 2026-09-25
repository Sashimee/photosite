import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

const serverApiMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('@/lib/server-api', () => ({ serverApi: serverApiMock }));
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

vi.mock('../../last-changed', () => ({ LastChanged: () => <div data-testid="last-changed" /> }));
vi.mock('./country-edit-form', () => ({
  CountryEditForm: () => <div data-testid="country-edit-form" />,
}));
vi.mock('./publish-legal-text-form', () => ({
  PublishLegalTextForm: () => <div data-testid="publish-legal-text-form" />,
}));

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

type AdminCountry = components['schemas']['AdminCountry'];
type AdminLegalTextVersion = components['schemas']['AdminLegalTextVersion'];

const country: AdminCountry = {
  code: 'LU',
  name: 'Luxembourg',
  currency: 'EUR',
  enabled: true,
  vatRate: 17,
  defaultLocale: 'fr',
  accountCount: 42,
};

function version(overrides: Partial<AdminLegalTextVersion> = {}): AdminLegalTextVersion {
  return {
    version: '1',
    kind: 'terms',
    locale: 'en',
    content: 'Terms content',
    publishedAt: '2026-01-01T00:00:00.000Z',
    publishedByAdminId: 'admin-1',
    ...overrides,
  };
}

function mockApi(getMock: ReturnType<typeof vi.fn>) {
  serverApiMock.mockResolvedValue({ GET: getMock });
}

describe('CountryDetailPage', () => {
  it('calls notFound for an unknown country code', async () => {
    mockApi(
      vi
        .fn()
        .mockResolvedValueOnce({ data: [country], response: { status: 200 } })
        .mockResolvedValueOnce({
          data: { countryCode: 'ZZ', versions: [] },
          response: { status: 200 },
        }),
    );
    const CountryDetailPage = await loadPage();

    await expect(CountryDetailPage({ params: Promise.resolve({ code: 'ZZ' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('throws when the countries list fails to load', async () => {
    mockApi(
      vi
        .fn()
        .mockResolvedValueOnce({ data: undefined, response: { status: 500 } })
        .mockResolvedValueOnce({
          data: { countryCode: 'LU', versions: [] },
          response: { status: 200 },
        }),
    );
    const CountryDetailPage = await loadPage();

    await expect(CountryDetailPage({ params: Promise.resolve({ code: 'LU' }) })).rejects.toThrow(
      /Failed to load countries: HTTP 500/,
    );
  });

  it('calls notFound when the legal-texts lookup 404s', async () => {
    mockApi(
      vi
        .fn()
        .mockResolvedValueOnce({ data: [country], response: { status: 200 } })
        .mockResolvedValueOnce({ data: undefined, response: { status: 404 } }),
    );
    const CountryDetailPage = await loadPage();

    await expect(CountryDetailPage({ params: Promise.resolve({ code: 'LU' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(notFoundMock).toHaveBeenCalled();
  });

  it('throws on an unexpected legal-texts load failure', async () => {
    mockApi(
      vi
        .fn()
        .mockResolvedValueOnce({ data: [country], response: { status: 200 } })
        .mockResolvedValueOnce({ data: undefined, response: { status: 500 } }),
    );
    const CountryDetailPage = await loadPage();

    await expect(CountryDetailPage({ params: Promise.resolve({ code: 'LU' }) })).rejects.toThrow(
      /Failed to load legal texts for LU: HTTP 500/,
    );
  });

  it('renders the empty state when there is no published legal text', async () => {
    mockApi(
      vi
        .fn()
        .mockResolvedValueOnce({ data: [country], response: { status: 200 } })
        .mockResolvedValueOnce({
          data: { countryCode: 'LU', versions: [] },
          response: { status: 200 },
        }),
    );
    const CountryDetailPage = await loadPage();

    render(await CountryDetailPage({ params: Promise.resolve({ code: 'LU' }) }));

    expect(
      screen.getByText('No legal text has been published for this country yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders the country fields and legal text versions in the order the API returns them', async () => {
    const first = version({ version: '1', publishedAt: '2026-01-01T00:00:00.000Z' });
    const second = version({ version: '2', publishedAt: '2026-02-01T00:00:00.000Z' });
    mockApi(
      vi
        .fn()
        .mockResolvedValueOnce({ data: [country], response: { status: 200 } })
        .mockResolvedValueOnce({
          data: { countryCode: 'LU', versions: [first, second] },
          response: { status: 200 },
        }),
    );
    const CountryDetailPage = await loadPage();

    render(await CountryDetailPage({ params: Promise.resolve({ code: 'LU' }) }));

    expect(screen.getByRole('heading', { name: 'Luxembourg' })).toBeInTheDocument();
    expect(screen.getByText('EUR')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('17 %')).toBeInTheDocument();
    expect(screen.getByText('fr')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('1');
    expect(rows[0]).toHaveTextContent('2026-01-01T00:00:00.000Z');
    expect(rows[1]).toHaveTextContent('2');
    expect(rows[1]).toHaveTextContent('2026-02-01T00:00:00.000Z');

    expect(screen.getByTestId('last-changed')).toBeInTheDocument();
    expect(screen.getByTestId('country-edit-form')).toBeInTheDocument();
    expect(screen.getByTestId('publish-legal-text-form')).toBeInTheDocument();
  });

  it('renders "No" for a disabled country', async () => {
    mockApi(
      vi
        .fn()
        .mockResolvedValueOnce({
          data: [{ ...country, enabled: false }],
          response: { status: 200 },
        })
        .mockResolvedValueOnce({
          data: { countryCode: 'LU', versions: [] },
          response: { status: 200 },
        }),
    );
    const CountryDetailPage = await loadPage();

    render(await CountryDetailPage({ params: Promise.resolve({ code: 'LU' }) }));

    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('renders a forbidden message instead of throwing on a 403', async () => {
    mockApi(
      vi
        .fn()
        .mockResolvedValueOnce({ data: undefined, response: { status: 403 } })
        .mockResolvedValueOnce({ data: undefined, response: { status: 403 } }),
    );
    const CountryDetailPage = await loadPage();

    render(await CountryDetailPage({ params: Promise.resolve({ code: 'LU' }) }));

    expect(screen.getByText("You don't have permission to do this.")).toBeInTheDocument();
    expect(screen.queryByTestId('country-edit-form')).not.toBeInTheDocument();
  });
});
