import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const getMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { GET: getMock } }));

// See suspend-dialog.test.tsx: a static import of the component under test
// would resolve '@/lib/api' - and read `getMock` - before the `const
// getMock` above is initialized.
async function loadUsersTable() {
  return (await import('./users-table')).UsersTable;
}

const baseUser = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  email: 'alice@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['photographer'],
  status: 'active',
  twoFactorEnabled: true,
  lastLoginAt: null,
};

describe('UsersTable', () => {
  it('masks the email and links the id to the detail page', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseUser], nextCursor: null } });
    const UsersTable = await loadUsersTable();

    render(<UsersTable />);

    expect(await screen.findByText('a***@example.com')).toBeInTheDocument();
    expect(screen.queryByText('alice@example.com')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: baseUser.id })).toHaveAttribute(
      'href',
      `/users/${baseUser.id}`,
    );
  });

  it('shows the translated role and status', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [baseUser], nextCursor: null } });
    const UsersTable = await loadUsersTable();

    render(<UsersTable />);

    expect(await screen.findByText('Photographer')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('explains the match rules in the empty state', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [], nextCursor: null } });
    const UsersTable = await loadUsersTable();

    render(<UsersTable />);

    expect(await screen.findByText('No users match your search.')).toBeInTheDocument();
    expect(
      screen.getByText('Matches an exact id, an exact email, or the start of a name.'),
    ).toBeInTheDocument();
  });

  it('forwards the filters and cursor to the API on every page', async () => {
    getMock.mockResolvedValueOnce({
      data: { items: [baseUser], nextCursor: 'page-2' },
    });
    getMock.mockResolvedValueOnce({ data: { items: [], nextCursor: null } });
    const UsersTable = await loadUsersTable();

    render(<UsersTable q="alice" role="photographer" status="active" />);
    await screen.findByText('a***@example.com');

    expect(getMock).toHaveBeenNthCalledWith(1, '/v1/admin/users', {
      params: { query: { q: 'alice', role: 'photographer', status: 'active' } },
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(getMock).toHaveBeenNthCalledWith(2, '/v1/admin/users', {
      params: {
        query: { q: 'alice', role: 'photographer', status: 'active', cursor: 'page-2' },
      },
    });
  });
});
