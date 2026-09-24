import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

import type { JobOfferFilters } from './job-offer-search-params';

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));
vi.mock('@/lib/api', () => ({ api: { GET: vi.fn().mockResolvedValue({ data: [] }) } }));

const COUNTRIES = [
  { code: 'LU', name: 'Luxembourg', currency: 'EUR', defaultLocale: 'fr' as const },
  { code: 'FR', name: 'France', currency: 'EUR', defaultLocale: 'fr' as const },
];

interface RenderFormOverrides {
  filters?: JobOfferFilters;
  hasActiveFilters?: boolean;
}

async function renderForm(overrides: RenderFormOverrides = {}) {
  const { JobOfferFiltersForm } = await import('./job-offer-filters');
  const element = await JobOfferFiltersForm({
    locale: 'en',
    filters: {},
    countries: COUNTRIES,
    action: '/en/job-offers',
    hasActiveFilters: false,
    clearHref: '/en/job-offers',
    ...overrides,
  });
  return render(element);
}

describe('JobOfferFiltersForm', () => {
  it('resolves every label from the real en catalog', async () => {
    await renderForm();

    expect(screen.getByRole('search', { name: 'Job offer filters' })).toBeInTheDocument();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByLabelText('Country')).toBeInTheDocument();
    expect(screen.getByLabelText('Keyword')).toBeInTheDocument();
    expect(screen.getByText('Remote only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  it('lists every country option', async () => {
    await renderForm();

    expect(screen.getByRole('option', { name: 'Luxembourg' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'France' })).toBeInTheDocument();
  });

  it('hides the clear-filters link without active filters and shows it once filtered', async () => {
    await renderForm();
    expect(screen.queryByRole('link', { name: 'Clear filters' })).not.toBeInTheDocument();

    await renderForm({ hasActiveFilters: true, filters: { city: 'Luxembourg' } });
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/en/job-offers',
    );
  });

  it('checks the remote switch when the remote filter is active', async () => {
    const { container } = await renderForm({ filters: { remote: true }, hasActiveFilters: true });

    expect(container.querySelector('input[name="remote"]')).toBeChecked();
  });
});
