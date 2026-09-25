import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

function lastCallProps(mock: typeof dataRequestsFiltersMock | typeof dataRequestsTableMock) {
  return (mock.mock.lastCall as [DataRequestsFiltersValue] | undefined)?.[0];
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

describe('DataRequestsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    expect(lastCallProps(dataRequestsFiltersMock)).toEqual({
      status: 'pending',
      type: 'delete',
      userId: '11111111-1111-4111-8111-111111111111',
    });
    expect(lastCallProps(dataRequestsTableMock)).toMatchObject({
      status: 'pending',
      type: 'delete',
      userId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('drops an invalid status instead of passing it to the table', async () => {
    const DataRequestsPage = await loadPage();

    render(await DataRequestsPage({ searchParams: Promise.resolve({ status: 'not-a-status' }) }));

    expect(lastCallProps(dataRequestsTableMock)?.status).toBeUndefined();
  });

  it('passes an invalid userId through to the filters and the table', async () => {
    const DataRequestsPage = await loadPage();

    render(await DataRequestsPage({ searchParams: Promise.resolve({ userId: 'not-a-uuid' }) }));

    expect(lastCallProps(dataRequestsFiltersMock)).toEqual({
      userId: 'not-a-uuid',
      userIdInvalid: true,
    });
    expect(lastCallProps(dataRequestsTableMock)).toMatchObject({
      userId: 'not-a-uuid',
      userIdInvalid: true,
    });
  });
});
