import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DataRequestsFilters as DataRequestsFiltersValue } from './data-requests-search-params';

vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

async function renderFilters(overrides: DataRequestsFiltersValue = {}) {
  const { DataRequestsFilters } = await import('./data-requests-filters');
  return render(await DataRequestsFilters(overrides));
}

describe('DataRequestsFilters', () => {
  it('renders the userId field, type and status selects and the submit button', async () => {
    await renderFilters();

    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('User id')).toBeInTheDocument();
    expect(screen.getByLabelText('Type')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  it('preselects the current filter values', async () => {
    await renderFilters({
      status: 'pending',
      type: 'delete',
      userId: '11111111-1111-1111-1111-111111111111',
    });

    expect(screen.getByLabelText('User id')).toHaveValue('11111111-1111-1111-1111-111111111111');
    expect(screen.getByLabelText('Type')).toHaveValue('delete');
    expect(screen.getByLabelText('Status')).toHaveValue('pending');
  });

  it('keeps the raw userId in the input and shows an invalid-id message', async () => {
    await renderFilters({ userId: 'not-a-uuid', userIdInvalid: true });

    expect(screen.getByLabelText('User id')).toHaveValue('not-a-uuid');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid user id.');
    expect(screen.getByLabelText('User id')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not show the invalid-id message for a valid userId', async () => {
    await renderFilters({ userId: '11111111-1111-1111-1111-111111111111' });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
