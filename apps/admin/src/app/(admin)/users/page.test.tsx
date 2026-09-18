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

const usersFiltersMock = vi.fn(() => <div data-testid="users-filters" />);
const usersTableMock = vi.fn(() => <div data-testid="users-table" />);
vi.mock('./users-filters', () => ({ UsersFilters: usersFiltersMock }));
vi.mock('./users-table', () => ({ UsersTable: usersTableMock }));

function firstCallProps(mock: typeof usersFiltersMock | typeof usersTableMock) {
  return (mock.mock.calls[0] as [UsersFiltersValue] | undefined)?.[0];
}

async function loadPage() {
  const mod = await import('./page');
  return mod.default;
}

describe('UsersPage', () => {
  it('renders the title and passes the parsed filters through', async () => {
    const UsersPage = await loadPage();

    render(
      await UsersPage({
        searchParams: Promise.resolve({ q: 'alice', role: 'photographer', status: 'active' }),
      }),
    );

    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByTestId('users-filters')).toBeInTheDocument();
    expect(screen.getByTestId('users-table')).toBeInTheDocument();
    expect(firstCallProps(usersFiltersMock)).toEqual({
      q: 'alice',
      role: 'photographer',
      status: 'active',
    });
    expect(firstCallProps(usersTableMock)).toMatchObject({
      q: 'alice',
      role: 'photographer',
      status: 'active',
    });
  });

  it('drops an invalid role instead of passing it to the table', async () => {
    const UsersPage = await loadPage();

    render(await UsersPage({ searchParams: Promise.resolve({ role: 'not-a-role' }) }));

    expect(firstCallProps(usersTableMock)?.role).toBeUndefined();
  });
});
