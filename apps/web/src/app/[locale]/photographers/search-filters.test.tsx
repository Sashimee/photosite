import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { SearchFilters } from '@/lib/search-params';
import { translate } from '@/testing/mock-translations';

interface RenderFormOverrides {
  filters?: SearchFilters;
  hasActiveFilters?: boolean;
}

vi.mock('next-intl/server', () => ({
  getTranslations:
    ({ namespace }: { namespace: string }) =>
    (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
}));
vi.mock('@/lib/api', () => ({ api: { GET: vi.fn().mockResolvedValue({ data: [] }) } }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/en/photographers',
  useSearchParams: () => new URLSearchParams(),
}));

async function renderForm(overrides: RenderFormOverrides = {}) {
  const { SearchFiltersForm } = await import('./search-filters');
  const element = await SearchFiltersForm({
    locale: 'en',
    filters: {},
    action: '/en/photographers',
    hasActiveFilters: false,
    clearHref: '/en/photographers',
    ...overrides,
  });
  return render(element);
}

describe('SearchFiltersForm', () => {
  it('resolves every label from the real en catalog', async () => {
    const { container } = await renderForm();

    expect(screen.getByRole('search', { name: 'Search filters' })).toBeInTheDocument();
    expect(container.querySelector('input[name="lat"]')).not.toBeInTheDocument();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByLabelText('Language')).toBeInTheDocument();
    expect(screen.getByLabelText('Min price')).toBeInTheDocument();
    expect(screen.getByLabelText('Max price')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Near me' })).toBeInTheDocument();
  });

  it('hides the clear-filters link without active filters and shows it, with the right label, once filtered', async () => {
    await renderForm();
    expect(screen.queryByRole('link', { name: 'Clear filters' })).not.toBeInTheDocument();

    await renderForm({ hasActiveFilters: true, filters: { city: 'Luxembourg' } });
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '/en/photographers',
    );
  });

  it('adds hidden lat/lng/radiusKm fields only once a location filter is set', async () => {
    const { container } = await renderForm({
      filters: { lat: 49.61, lng: 6.13, radiusKm: 25 },
      hasActiveFilters: true,
    });

    expect(container.querySelector('input[name="lat"]')).toHaveValue('49.61');
    expect(container.querySelector('input[name="lng"]')).toHaveValue('6.13');
    expect(container.querySelector('input[name="radiusKm"]')).toHaveValue('25');
  });
});
