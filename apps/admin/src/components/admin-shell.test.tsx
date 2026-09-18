import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { AdminShell } from './admin-shell';

const NAV_SECTIONS = [
  { id: 'dashboard', href: '/', label: 'Dashboard', available: true },
  {
    id: 'users',
    href: '/users',
    label: 'Users',
    available: false,
    note: 'Coming in step 1D.2',
  },
];

describe('AdminShell', () => {
  it('renders an available section as a real link', () => {
    render(
      <AdminShell email="admin@example.com" navSections={NAV_SECTIONS} signOutLabel="Sign out">
        <p>content</p>
      </AdminShell>,
    );

    const link = screen.getByRole('link', { name: 'Dashboard' });
    expect(link).toHaveAttribute('href', '/');
  });

  it('renders an unavailable section with its reason instead of a link', () => {
    render(
      <AdminShell email="admin@example.com" navSections={NAV_SECTIONS} signOutLabel="Sign out">
        <p>content</p>
      </AdminShell>,
    );

    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Coming in step 1D.2')).toBeInTheDocument();
  });

  it('shows the signed-in admin and a sign-out action', () => {
    render(
      <AdminShell email="admin@example.com" navSections={NAV_SECTIONS} signOutLabel="Sign out">
        <p>content</p>
      </AdminShell>,
    );

    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('renders the children inside the shell', () => {
    render(
      <AdminShell email="admin@example.com" navSections={NAV_SECTIONS} signOutLabel="Sign out">
        <p>page content</p>
      </AdminShell>,
    );

    expect(screen.getByText('page content')).toBeInTheDocument();
  });
});
