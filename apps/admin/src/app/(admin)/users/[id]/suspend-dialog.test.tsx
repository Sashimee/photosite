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
  status: 'active',
  twoFactorEnabled: true,
  lastLoginAt: null,
};

// Static top-level imports run before this file's own top-level statements
// (ESM import hoisting), so importing the component here would resolve
// './suspend-dialog' - and the `postMock` reference inside the mock factory
// above it - before `postMock` itself is initialized. Loading it lazily
// keeps the module graph load after `postMock` exists.
async function loadSuspendDialog() {
  return (await import('./suspend-dialog')).SuspendDialog;
}

async function openDialog() {
  const SuspendDialog = await loadSuspendDialog();
  const events = userEvent.setup();
  render(<SuspendDialog user={user} onSuspended={vi.fn()} />);
  await events.click(screen.getByRole('button', { name: 'Suspend' }));
  return events;
}

describe('SuspendDialog', () => {
  it('names the consequences before confirming', async () => {
    await openDialog();

    expect(screen.getByText('Suspend this user?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'This signs them out of every device and drops their chat connections. It does not delete anything.',
      ),
    ).toBeInTheDocument();
  });

  it('requires a reason before it will submit', async () => {
    const events = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Suspend user' }));

    expect(await screen.findByText('This value is too short.')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('posts the reason and calls onSuspended on success', async () => {
    postMock.mockResolvedValueOnce({ data: { ...user, status: 'suspended' } });
    const onSuspended = vi.fn();
    const SuspendDialog = await loadSuspendDialog();
    const events = userEvent.setup();
    render(<SuspendDialog user={user} onSuspended={onSuspended} />);
    await events.click(screen.getByRole('button', { name: 'Suspend' }));

    await events.type(screen.getByLabelText('Reason'), 'Fraudulent bookings');
    await events.click(screen.getByRole('button', { name: 'Suspend user' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/users/{id}/suspend', {
        params: { path: { id: 'user-1' } },
        body: { reason: 'Fraudulent bookings' },
      });
    });
    await waitFor(() => {
      expect(onSuspended).toHaveBeenCalled();
    });
  });

  it('shows a mapped error message for an ordinary failure', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const events = await openDialog();

    await events.type(screen.getByLabelText('Reason'), 'Fraudulent bookings');
    await events.click(screen.getByRole('button', { name: 'Suspend user' }));

    expect(
      await screen.findByText(
        "That couldn't be completed because something changed. Please retry.",
      ),
    ).toBeInTheDocument();
  });

  it('routes a stale second factor to re-verification instead of showing a toast', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const onSuspended = vi.fn();
    const SuspendDialog = await loadSuspendDialog();
    const events = userEvent.setup();
    render(<SuspendDialog user={user} onSuspended={onSuspended} />);
    await events.click(screen.getByRole('button', { name: 'Suspend' }));

    await events.type(screen.getByLabelText('Reason'), 'Fraudulent bookings');
    await events.click(screen.getByRole('button', { name: 'Suspend user' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onSuspended).not.toHaveBeenCalled();
  });
});
