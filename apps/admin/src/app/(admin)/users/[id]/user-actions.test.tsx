import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({ api: { POST: vi.fn(), PUT: vi.fn() } }));

import type { components } from '@photoo/api-client';

import { UserActions } from './user-actions';

const activeUser: components['schemas']['User'] = {
  id: 'user-1',
  email: 'alice@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['client'],
  status: 'active',
  twoFactorEnabled: true,
  lastLoginAt: null,
};

describe('UserActions', () => {
  it('a support admin sees no roles control', () => {
    render(<UserActions user={activeUser} canManageRoles={false} />);

    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit roles' })).not.toBeInTheDocument();
  });

  it('a superadmin sees the roles control', () => {
    render(<UserActions user={activeUser} canManageRoles={true} />);

    expect(screen.getByRole('button', { name: 'Edit roles' })).toBeInTheDocument();
  });

  it('shows suspend for an active user and reactivate for a suspended one', () => {
    const { rerender } = render(<UserActions user={activeUser} canManageRoles={false} />);
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();

    rerender(<UserActions user={{ ...activeUser, status: 'suspended' }} canManageRoles={false} />);
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });
});
