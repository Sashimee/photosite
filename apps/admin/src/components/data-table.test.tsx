import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

import { DataTable, type DataTableColumn, type DataTableFetchResult } from './data-table';

interface Row {
  id: string;
  name: string;
}

const columns: DataTableColumn<Row>[] = [{ id: 'name', header: 'Name', cell: (row) => row.name }];

function renderTable(
  fetchPage: (cursor: string | undefined) => Promise<DataTableFetchResult<Row>>,
) {
  return render(
    <DataTable
      columns={columns}
      fetchPage={fetchPage}
      getRowId={(row) => row.id}
      caption="Test rows"
      emptyState={<p>No rows match your search.</p>}
    />,
  );
}

describe('DataTable', () => {
  it('shows a loading state while the first page is in flight', () => {
    renderTable(() => new Promise(() => undefined));

    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  it('renders rows from the first page', async () => {
    renderTable(() =>
      Promise.resolve({ data: { items: [{ id: '1', name: 'Alice' }], nextCursor: null } }),
    );

    expect(await screen.findByText('Alice')).toBeInTheDocument();
  });

  it('advances by cursor on next and does not refetch page one on back', async () => {
    const fetchPage = vi.fn((cursor: string | undefined) => {
      if (cursor === undefined) {
        return Promise.resolve({
          data: { items: [{ id: '1', name: 'Alice' }], nextCursor: 'page-2' },
        });
      }
      if (cursor === 'page-2') {
        return Promise.resolve({ data: { items: [{ id: '2', name: 'Bob' }], nextCursor: null } });
      }
      return Promise.reject(new Error(`unexpected cursor ${cursor}`));
    });
    renderTable(fetchPage);
    const user = userEvent.setup();

    await screen.findByText('Alice');
    expect(fetchPage).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'page-2');

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(fetchPage).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Bob')).toBeInTheDocument();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('disables next when there is no further cursor and previous on page one', async () => {
    renderTable(() =>
      Promise.resolve({ data: { items: [{ id: '1', name: 'Alice' }], nextCursor: null } }),
    );

    await screen.findByText('Alice');

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('renders the empty state with its explanation when the page has no rows', async () => {
    renderTable(() => Promise.resolve({ data: { items: [], nextCursor: null } }));

    expect(await screen.findByText('No rows match your search.')).toBeInTheDocument();
  });

  it('renders a mapped error message instead of the raw error and retries', async () => {
    const fetchPage = vi
      .fn<(cursor: string | undefined) => Promise<DataTableFetchResult<Row>>>()
      .mockResolvedValueOnce({ error: { code: 'FORBIDDEN', message: 'internal detail' } })
      .mockResolvedValueOnce({ data: { items: [{ id: '1', name: 'Alice' }], nextCursor: null } });
    renderTable(fetchPage);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("You don't have permission to view this.");
    expect(alert).not.toHaveTextContent('internal detail');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('shows a generic message when fetchPage throws instead of returning an ApiError', async () => {
    renderTable(() => Promise.reject(new Error('network is down')));

    const alert = await screen.findByRole('alert');
    await waitFor(() => {
      expect(alert).toHaveTextContent('An error occurred');
    });
    expect(alert).not.toHaveTextContent('network is down');
  });
});
