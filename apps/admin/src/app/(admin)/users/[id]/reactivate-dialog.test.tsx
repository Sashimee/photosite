import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

import type { components } from '@photoo/api-client';

const user: components['schemas']['User'] = {
  id: 'user-1',
  email: 'alice@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['client'],
  status: 'suspended',
  twoFactorEnabled: true,
  lastLoginAt: null,
};

// See suspend-dialog.test.tsx: a static import of the component under test
// would resolve '@/lib/api' - and read `postMock` - before the `const
// postMock` above is initialized.
async function loadReactivateDialog() {
  return (await import('./reactivate-dialog')).ReactivateDialog;
}

describe('ReactivateDialog', () => {
  it('warns that sessions are not restored', async () => {
    const ReactivateDialog = await loadReactivateDialog();
    const events = userEvent.setup();
    render(<ReactivateDialog user={user} onReactivated={vi.fn()} />);
    await events.click(screen.getByRole('button', { name: 'Reactivate' }));

    expect(
      screen.getByText(
        'This restores their status only. It does not restore the sessions that suspension signed out.',
      ),
    ).toBeInTheDocument();
  });

  it('confirms and calls onReactivated on success', async () => {
    postMock.mockResolvedValueOnce({ data: { ...user, status: 'active' } });
    const onReactivated = vi.fn();
    const ReactivateDialog = await loadReactivateDialog();
    const events = userEvent.setup();
    render(<ReactivateDialog user={user} onReactivated={onReactivated} />);
    await events.click(screen.getByRole('button', { name: 'Reactivate' }));
    await events.click(screen.getByRole('button', { name: 'Reactivate user' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/users/{id}/reactivate', {
        params: { path: { id: 'user-1' } },
      });
    });
    expect(onReactivated).toHaveBeenCalled();
  });

  it('routes a stale second factor to re-verification instead of showing a toast', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const onReactivated = vi.fn();
    const ReactivateDialog = await loadReactivateDialog();
    const events = userEvent.setup();
    render(<ReactivateDialog user={user} onReactivated={onReactivated} />);
    await events.click(screen.getByRole('button', { name: 'Reactivate' }));
    await events.click(screen.getByRole('button', { name: 'Reactivate user' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onReactivated).not.toHaveBeenCalled();
  });
});
