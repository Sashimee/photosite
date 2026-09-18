import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { UsersFilters as UsersFiltersValue } from './users-search-params';

vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

async function renderFilters(overrides: UsersFiltersValue = {}) {
  const { UsersFilters } = await import('./users-filters');
  return render(await UsersFilters(overrides));
}

describe('UsersFilters', () => {
  it('renders the search field, role and status selects and the submit button', async () => {
    await renderFilters();

    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  it('explains the match rules under the search field', async () => {
    await renderFilters();

    expect(
      screen.getByText('Matches an exact id, an exact email, or the start of a name.'),
    ).toBeInTheDocument();
  });

  it('preselects the current filter values', async () => {
    await renderFilters({ q: 'alice', role: 'photographer', status: 'suspended' });

    expect(screen.getByLabelText('Search')).toHaveValue('alice');
    expect(screen.getByLabelText('Role')).toHaveValue('photographer');
    expect(screen.getByLabelText('Status')).toHaveValue('suspended');
  });
});
