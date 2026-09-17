import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionUser } from '@/lib/session';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => (key === 'account' ? 'Account' : 'Sign out'),
}));

const sampleUser: SessionUser = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  email: 'client@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['client'],
  status: 'active',
  twoFactorEnabled: false,
  lastLoginAt: null,
};

async function loadAccountMenu() {
  const { AccountMenu } = await import('./account-menu');
  return AccountMenu;
}

describe('AccountMenu', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    pushMock.mockClear();
    refreshMock.mockClear();
  });

  it('shows the signed-in email on the trigger and an account link', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const AccountMenu = await loadAccountMenu();
    const user = userEvent.setup();

    render(<AccountMenu locale="en" user={sampleUser} />);

    expect(screen.getByRole('button', { name: 'client@example.com' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'client@example.com' }));

    expect(await screen.findByRole('menuitem', { name: 'Account' })).toHaveAttribute(
      'href',
      '/en/account',
    );
  });

  it('signs out, refreshes the session and navigates home', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'UNAUTHORIZED' }), { status: 401 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const AccountMenu = await loadAccountMenu();
    const user = userEvent.setup();

    render(<AccountMenu locale="en" user={sampleUser} />);
    await user.click(screen.getByRole('button', { name: 'client@example.com' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }));

    expect(await screen.findByRole('button', { name: 'Account' })).toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledWith('/en');
    expect(refreshMock).toHaveBeenCalled();
  });
});
