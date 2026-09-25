import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

// Static top-level imports run before this file's own top-level statements
// (ESM import hoisting), so importing the component here would resolve
// './log-request-dialog' - and the `postMock` reference inside the mock
// factory above it - before `postMock` itself is initialized. Loading it
// lazily keeps the module graph load after `postMock` exists.
async function loadLogRequestDialog() {
  return (await import('./log-request-dialog')).LogRequestDialog;
}

async function openDialog(onLogged = vi.fn()) {
  const LogRequestDialog = await loadLogRequestDialog();
  const events = userEvent.setup();
  render(<LogRequestDialog onLogged={onLogged} />);
  await events.click(screen.getByRole('button', { name: 'Log request' }));
  return { events, onLogged };
}

const VALID_USER_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

async function fillValidForm(events: ReturnType<typeof userEvent.setup>) {
  await events.type(screen.getByLabelText('User id'), VALID_USER_ID);
  await events.selectOptions(screen.getByLabelText('Type'), 'export');
  await events.selectOptions(screen.getByLabelText('Channel'), 'email');
  fireEvent.change(screen.getByLabelText('Received at'), {
    target: { value: '2026-09-20T10:30' },
  });
}

describe('LogRequestDialog', () => {
  it('does not call the API before the confirm step', async () => {
    await openDialog();

    expect(postMock).not.toHaveBeenCalled();
  });

  it('shows required-field errors after confirming with nothing filled in', async () => {
    const { events } = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findAllByText('This field is required.')).toHaveLength(3);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('shows an invalid-format error for a malformed user id', async () => {
    const { events } = await openDialog();

    await events.type(screen.getByLabelText('User id'), 'not-a-uuid');
    await events.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Enter a valid value.')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('shows a required error when the received-at field is cleared', async () => {
    const { events } = await openDialog();

    fireEvent.change(screen.getByLabelText('Received at'), { target: { value: '' } });
    await events.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findAllByText('This field is required.')).toHaveLength(4);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('submits the entered values and calls onLogged on success', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        id: 'new-id',
        type: 'export',
        status: 'pending',
        channel: 'email',
        requestedAt: '2026-09-26T12:00:00.000Z',
        completedAt: null,
        expiresAt: null,
        failureReason: null,
        cancelledAt: null,
        responseDueAt: '2026-10-26T12:00:00.000Z',
        answeredLate: false,
        user: { id: VALID_USER_ID, email: 'alice@example.com' },
      },
    });
    const { events, onLogged } = await openDialog();
    await fillValidForm(events);

    await events.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/admin/data-requests', {
        body: {
          userId: VALID_USER_ID,
          type: 'export',
          channel: 'email',
          receivedAt: new Date('2026-09-20T10:30').toISOString(),
        },
      });
    });
    await waitFor(() => {
      expect(onLogged).toHaveBeenCalled();
    });
  });

  it('routes a stale second factor to re-verification instead of showing a toast', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const { events, onLogged } = await openDialog();
    await fillValidForm(events);

    await events.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    expect(onLogged).not.toHaveBeenCalled();
  });

  it('shows the open-export message for EXPORT_OPEN', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'EXPORT_OPEN' } });
    const { events, onLogged } = await openDialog();
    await fillValidForm(events);

    await events.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText('This user already has an open export request.'),
    ).toBeInTheDocument();
    expect(onLogged).not.toHaveBeenCalled();
  });

  it('shows the open-deletion message for DELETE_OPEN', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'DELETE_OPEN' } });
    const { events, onLogged } = await openDialog();
    await fillValidForm(events);

    await events.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText('This user already has an open deletion request.'),
    ).toBeInTheDocument();
    expect(onLogged).not.toHaveBeenCalled();
  });

  it('shows a suspended-account message for USER_SUSPENDED', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'USER_SUSPENDED' } });
    const { events, onLogged } = await openDialog();
    await fillValidForm(events);

    await events.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText("This user's account is suspended, so the request can't be logged."),
    ).toBeInTheDocument();
    expect(onLogged).not.toHaveBeenCalled();
  });

  it('shows a deleted-account message for USER_DELETED', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'USER_DELETED' } });
    const { events, onLogged } = await openDialog();
    await fillValidForm(events);

    await events.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText("This user's account has already been deleted."),
    ).toBeInTheDocument();
    expect(onLogged).not.toHaveBeenCalled();
  });

  it('shows a blocking-obligations message for BLOCKING_OBLIGATIONS', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'BLOCKING_OBLIGATIONS' } });
    const { events, onLogged } = await openDialog();
    await fillValidForm(events);

    await events.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(
      await screen.findByText(
        'This deletion is blocked by obligations the user still has open, such as active bookings or unresolved payouts.',
      ),
    ).toBeInTheDocument();
    expect(onLogged).not.toHaveBeenCalled();
  });

  it('falls back to the generic message for an unmapped code', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'SOME_UNKNOWN_CODE' } });
    const { events, onLogged } = await openDialog();
    await fillValidForm(events);

    await events.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(onLogged).not.toHaveBeenCalled();
  });

  it('shows the delete warning only when the type is set to deletion', async () => {
    const { events } = await openDialog();

    expect(
      screen.queryByText(
        "Logging a deletion request deletes the account immediately. This can't be undone.",
      ),
    ).not.toBeInTheDocument();

    await events.selectOptions(screen.getByLabelText('Type'), 'delete');

    expect(
      await screen.findByText(
        "Logging a deletion request deletes the account immediately. This can't be undone.",
      ),
    ).toBeInTheDocument();

    await events.selectOptions(screen.getByLabelText('Type'), 'export');

    expect(
      screen.queryByText(
        "Logging a deletion request deletes the account immediately. This can't be undone.",
      ),
    ).not.toBeInTheDocument();
  });
});
