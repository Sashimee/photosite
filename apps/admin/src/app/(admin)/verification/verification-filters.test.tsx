import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { VerificationFilters as VerificationFiltersValue } from './verification-search-params';

vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

async function renderFilters(overrides: VerificationFiltersValue) {
  const { VerificationFilters } = await import('./verification-filters');
  return render(await VerificationFilters(overrides));
}

describe('VerificationFilters', () => {
  it('renders the status select and the country input', async () => {
    await renderFilters({ status: 'submitted' });

    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Country code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
  });

  it('preselects the current filter values', async () => {
    await renderFilters({ status: 'in_review', countryCode: 'LU' });

    expect(screen.getByLabelText('Status')).toHaveValue('in_review');
    expect(screen.getByLabelText('Country code')).toHaveValue('LU');
  });
});
