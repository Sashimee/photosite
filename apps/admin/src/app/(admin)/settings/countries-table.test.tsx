import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { components } from '@photoo/api-client';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./country-toggle-dialog', () => ({
  CountryToggleDialog: () => <div data-testid="country-toggle-dialog" />,
}));

type AdminCountry = components['schemas']['AdminCountry'];

const country: AdminCountry = {
  code: 'LU',
  name: 'Luxembourg',
  currency: 'EUR',
  enabled: true,
  vatRate: 17,
  defaultLocale: 'fr',
  accountCount: 42,
};

async function loadCountriesTable() {
  return (await import('./countries-table')).CountriesTable;
}

describe('CountriesTable', () => {
  it('renders the VAT rate as a percentage using the i18n key', async () => {
    const CountriesTable = await loadCountriesTable();

    render(<CountriesTable countries={[country]} headingId="countries-heading" />);

    expect(screen.getByText('17 %')).toBeInTheDocument();
    expect(screen.queryByText('17%')).not.toBeInTheDocument();
    expect(screen.queryByText('17')).not.toBeInTheDocument();
  });

  it('renders a fractional VAT rate', async () => {
    const CountriesTable = await loadCountriesTable();

    render(
      <CountriesTable countries={[{ ...country, vatRate: 8.5 }]} headingId="countries-heading" />,
    );

    expect(screen.getByText('8.5 %')).toBeInTheDocument();
  });
});
