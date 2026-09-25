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

const request: components['schemas']['AdminDataRequest'] = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  type: 'export',
  status: 'failed',
  channel: 'in_app',
  requestedAt: '2026-09-01T12:00:00.000Z',
  completedAt: null,
  expiresAt: null,
  failureReason: 'export_failed',
  cancelledAt: null,
  responseDueAt: null,
  answeredLate: false,
  user: { id: 'a1a1a1a1-1111-1111-1111-111111111111', email: 'alice@example.com' },
};

// Static top-level imports run before this file's own top-level statements
// (ESM import hoisting), so importing the component here would resolve
// './retry-export-dialog' - and the `postMock` reference inside the mock
// factory above it - before `postMock` itself is initialized. Loading it
// lazily keeps the module graph load after `postMock` exists.
async function loadRetryExportDialog() {
  return (await import('./retry-export-dialog')).RetryExportDialog;
}

async function openDialog(onRetried = vi.fn()) {
  const RetryExportDialog = await loadRetryExportDialog();
  const events = userEvent.setup();
  render(<RetryExportDialog request={request} onRetried={onRetried} />);
  await events.click(screen.getByRole('button', { name: 'Retry export' }));
  return { events, onRetried };
}

describe('RetryExportDialog', () => {
  it('names the consequences before confirming', async () => {
    await openDialog();

    expect(screen.getByText('Retry this export?')).toBeInTheDocument();
    expect(
      screen.getByText(
        "This creates a new export request for the user and starts it right away. It doesn't change the failed request itself.",
      ),
    ).toBeInTheDocument();
  });

  it('does not call the API before the confirm step', async () => {
    await openDialog();

    expect(postMock).not.toHaveBeenCalled();
  });

  it('posts the retry and calls onRetried on success', async () => {
    postMock.mockResolvedValueOnce({ data: { ...request, id: 'new-id', status: 'processing' } });
    const { events, onRetried } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/data-requests/{id}/retry-export', {
        params: { path: { id: request.id } },
      });
    });
    await waitFor(() => {
      expect(onRetried).toHaveBeenCalled();
    });
  });

  it('shows the conflict message for a 409 and does not call onRetried', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    const { events, onRetried } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    expect(
      await screen.findByText(
        "That couldn't be completed because something changed. Please retry.",
      ),
    ).toBeInTheDocument();
    expect(onRetried).not.toHaveBeenCalled();
  });

  it('shows the not-found message for a 404', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'NOT_FOUND' } });
    const { events } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    expect(await screen.findByText("This couldn't be found.")).toBeInTheDocument();
  });

  it('routes a stale second factor to re-verification instead of showing a toast', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const { events, onRetried } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm retry' })).toBeInTheDocument();
    expect(onRetried).not.toHaveBeenCalled();
  });

  it('shows a suspended-account message for USER_SUSPENDED and does not refresh the list', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'USER_SUSPENDED' } });
    const { events, onRetried } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    expect(
      await screen.findByText(
        "This user's account is suspended, so their export can't be retried.",
      ),
    ).toBeInTheDocument();
    expect(onRetried).not.toHaveBeenCalled();
  });

  it('shows a deleted-account message for USER_DELETED and does not refresh the list', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'USER_DELETED' } });
    const { events, onRetried } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    expect(
      await screen.findByText(
        "This user's account has been deleted, so their export can't be retried.",
      ),
    ).toBeInTheDocument();
    expect(onRetried).not.toHaveBeenCalled();
  });

  it('shows an already-retried message for EXPORT_ALREADY_RETRIED and refreshes the list', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'EXPORT_ALREADY_RETRIED' } });
    const { events, onRetried } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    expect(
      await screen.findByText(
        'This export was already retried once — check the newer request in the list. The list has been refreshed.',
      ),
    ).toBeInTheDocument();
    expect(onRetried).toHaveBeenCalled();
  });

  it('shows a no-longer-failed message for EXPORT_NOT_FAILED and refreshes the list', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'EXPORT_NOT_FAILED' } });
    const { events, onRetried } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    expect(
      await screen.findByText(
        "This request is no longer a failed export, so it can't be retried. The list has been refreshed.",
      ),
    ).toBeInTheDocument();
    expect(onRetried).toHaveBeenCalled();
  });

  it('shows an export-in-progress message for EXPORT_OPEN and refreshes the list', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'EXPORT_OPEN' } });
    const { events, onRetried } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    expect(
      await screen.findByText(
        'An export for this user is already in progress. The list has been refreshed.',
      ),
    ).toBeInTheDocument();
    expect(onRetried).toHaveBeenCalled();
  });

  it('shows an already-answered message for EXPORT_ALREADY_ANSWERED and refreshes the list', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'EXPORT_ALREADY_ANSWERED' } });
    const { events, onRetried } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    expect(
      await screen.findByText(
        'The user already has a newer export, so no retry is needed. The list has been refreshed.',
      ),
    ).toBeInTheDocument();
    expect(onRetried).toHaveBeenCalled();
  });

  it('shows a rate-limit message for TOO_MANY_REQUESTS', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TOO_MANY_REQUESTS' } });
    const { events, onRetried } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    expect(
      await screen.findByText("You're doing that too fast. Slow down and try again."),
    ).toBeInTheDocument();
    expect(onRetried).not.toHaveBeenCalled();
  });

  it('falls back to the generic message for an unmapped code', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'SOME_UNKNOWN_CODE' } });
    const { events, onRetried } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm retry' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(onRetried).not.toHaveBeenCalled();
  });
});
