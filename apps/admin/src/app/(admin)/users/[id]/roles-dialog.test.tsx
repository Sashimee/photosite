import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const putMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { PUT: putMock } }));

import type { components } from '@photoo/api-client';

const user: components['schemas']['User'] = {
  id: 'user-1',
  email: 'alice@example.com',
  emailVerifiedAt: null,
  locale: 'en',
  country: 'LU',
  roles: ['client', 'photographer'],
  status: 'active',
  twoFactorEnabled: true,
  lastLoginAt: null,
};

// See suspend-dialog.test.tsx: a static import of the component under test
// would resolve '@/lib/api' - and read `putMock` - before the `const
// putMock` above is initialized.
async function loadRolesDialog() {
  return (await import('./roles-dialog')).RolesDialog;
}

async function openDialog() {
  const RolesDialog = await loadRolesDialog();
  const events = userEvent.setup();
  render(<RolesDialog user={user} onRolesChanged={vi.fn()} />);
  await events.click(screen.getByRole('button', { name: 'Edit roles' }));
  return events;
}

describe('RolesDialog', () => {
  it('preselects the user current roles', async () => {
    await openDialog();

    expect(screen.getByRole('checkbox', { name: 'Client' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Photographer' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Professional' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Admin' })).not.toBeChecked();
  });

  it('warns when unchecking photographer on a user that currently has it', async () => {
    const events = await openDialog();

    expect(
      screen.queryByText(
        "If this user's photographer profile is published, removing the photographer role will unpublish it immediately.",
      ),
    ).not.toBeInTheDocument();

    await events.click(screen.getByRole('checkbox', { name: 'Photographer' }));

    expect(
      screen.getByText(
        "If this user's photographer profile is published, removing the photographer role will unpublish it immediately.",
      ),
    ).toBeInTheDocument();
  });

  it('does not warn when photographer stays checked', async () => {
    const events = await openDialog();

    await events.click(screen.getByRole('checkbox', { name: 'Admin' }));

    expect(
      screen.queryByText(
        "If this user's photographer profile is published, removing the photographer role will unpublish it immediately.",
      ),
    ).not.toBeInTheDocument();
  });

  it('disables confirm and shows a validation notice with no roles selected', async () => {
    const events = await openDialog();

    await events.click(screen.getByRole('checkbox', { name: 'Client' }));
    await events.click(screen.getByRole('checkbox', { name: 'Photographer' }));

    expect(screen.getByText('This field is required.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save roles' })).toBeDisabled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it('sends the whole resulting set on confirm', async () => {
    putMock.mockResolvedValueOnce({ data: { ...user, roles: ['client', 'admin'] } });
    const onRolesChanged = vi.fn();
    const RolesDialog = await loadRolesDialog();
    const events = userEvent.setup();
    render(<RolesDialog user={user} onRolesChanged={onRolesChanged} />);
    await events.click(screen.getByRole('button', { name: 'Edit roles' }));

    await events.click(screen.getByRole('checkbox', { name: 'Photographer' }));
    await events.click(screen.getByRole('checkbox', { name: 'Admin' }));
    await events.click(screen.getByRole('button', { name: 'Save roles' }));

    await waitFor(() => {
      expect(putMock).toHaveBeenCalledWith('/v1/admin/users/{id}/roles', {
        params: { path: { id: 'user-1' } },
        body: { roles: ['client', 'admin'] },
      });
    });
    expect(onRolesChanged).toHaveBeenCalled();
  });

  it('routes a stale second factor to re-verification instead of showing a toast', async () => {
    putMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const onRolesChanged = vi.fn();
    const RolesDialog = await loadRolesDialog();
    const events = userEvent.setup();
    render(<RolesDialog user={user} onRolesChanged={onRolesChanged} />);
    await events.click(screen.getByRole('button', { name: 'Edit roles' }));
    await events.click(screen.getByRole('button', { name: 'Save roles' }));

    await waitFor(() => {
      expect(putMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onRolesChanged).not.toHaveBeenCalled();
  });
});
