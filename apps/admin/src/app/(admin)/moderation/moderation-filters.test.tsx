import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ModerationFilters as ModerationFiltersValue } from './moderation-search-params';

vi.mock('next-intl/server', async () => {
  const { translate } = await import('@/testing/mock-translations');
  return {
    getTranslations: (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      translate(namespace, key, values),
  };
});

async function renderFilters(overrides: ModerationFiltersValue) {
  const { ModerationFilters } = await import('./moderation-filters');
  return render(await ModerationFilters(overrides));
}

describe('ModerationFilters', () => {
  it('renders the status and target-type selects', async () => {
    await renderFilters({ status: 'open' });

    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Target type')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
  });

  it('preselects the current filter values', async () => {
    await renderFilters({ status: 'resolved', targetType: 'portfolio_image' });

    expect(screen.getByLabelText('Status')).toHaveValue('resolved');
    expect(screen.getByLabelText('Target type')).toHaveValue('portfolio_image');
  });

  it('leaves the target type unselected (all types) with no filter set', async () => {
    await renderFilters({ status: 'open' });

    expect(screen.getByLabelText('Target type')).toHaveValue('');
  });

  it('leaves the moderator-initiated checkbox unchecked by default', async () => {
    await renderFilters({ status: 'open' });

    expect(
      screen.getByLabelText('Only content a moderator took down directly, with no report'),
    ).not.toBeChecked();
  });

  it('preselects the moderator-initiated checkbox when set', async () => {
    await renderFilters({ status: 'resolved', moderatorInitiated: true });

    expect(
      screen.getByLabelText('Only content a moderator took down directly, with no report'),
    ).toBeChecked();
  });
});
