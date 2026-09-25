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

const dataRequestsFiltersMock = vi.fn(() => <div data-testid="data-requests-filters" />);
const dataRequestsTableMock = vi.fn(() => <div data-testid="data-requests-table" />);
vi.mock('./data-requests-filters', () => ({ DataRequestsFilters: dataRequestsFiltersMock }));
vi.mock('./data-requests-table', () => ({ DataRequestsTable: dataRequestsTableMock }));

function firstCallProps(mock: typeof dataRequestsFiltersMock | typeof dataRequestsTableMock) {
  return (mock.mock.calls[0] as [DataRequestsFiltersValue] | undefined)?.[0];
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

describe('DataRequestsPage', () => {
  it('renders the title, the verification-documents note, and passes the parsed filters through', async () => {
    const DataRequestsPage = await loadPage();

    render(
      await DataRequestsPage({
        searchParams: Promise.resolve({
          status: 'pending',
          type: 'delete',
          userId: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );

    expect(screen.getByText('Data requests')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Copies of verification documents aren't available here. A subject who wants copies of theirs goes through the manual support process, not this list.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('data-requests-filters')).toBeInTheDocument();
    expect(screen.getByTestId('data-requests-table')).toBeInTheDocument();
    expect(firstCallProps(dataRequestsFiltersMock)).toEqual({
      status: 'pending',
      type: 'delete',
      userId: '11111111-1111-4111-8111-111111111111',
    });
    expect(firstCallProps(dataRequestsTableMock)).toMatchObject({
      status: 'pending',
      type: 'delete',
      userId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('drops an invalid status instead of passing it to the table', async () => {
    const DataRequestsPage = await loadPage();

    render(await DataRequestsPage({ searchParams: Promise.resolve({ status: 'not-a-status' }) }));

    expect(firstCallProps(dataRequestsTableMock)?.status).toBeUndefined();
  });
});
