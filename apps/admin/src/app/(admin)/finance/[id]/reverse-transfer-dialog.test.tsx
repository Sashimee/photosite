import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

function failure(code: string, status = 409, message?: string) {
  return { error: { code, message }, response: { ok: false, status } };
}

async function openDialog(onDone = vi.fn(), onUnknownOutcome = vi.fn()) {
  const { ReverseTransferDialog } = await import('./reverse-transfer-dialog');
  const events = userEvent.setup();
  render(
    <ReverseTransferDialog
      bookingId="booking-1"
      currency="EUR"
      reversedCents={1000}
      disabled={false}
      onDone={onDone}
      onUnknownOutcome={onUnknownOutcome}
    />,
  );
  await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));
  return events;
}

beforeEach(() => {
  postMock.mockReset();
});

describe('ReverseTransferDialog', () => {
  it('names the booking and currency and warns about the second factor', async () => {
    await openDialog();

    expect(
      screen.getByText(
        'You are about to reverse the remaining transfer (EUR) on booking booking-1.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/asks for your second factor again/)).toBeInTheDocument();
    expect(screen.getByText(/recover a lost chargeback/)).toBeInTheDocument();
    expect(screen.getByText(/use Refund instead/)).toBeInTheDocument();
    expect(
      screen.getByText(/can no longer be refunded to the client from here/),
    ).toBeInTheDocument();
  });

  it('sends exactly the trimmed reason', async () => {
    postMock.mockResolvedValueOnce({
      data: { id: 'booking-1' },
      response: { ok: true, status: 200 },
    });
    const onDone = vi.fn();
    const events = await openDialog(onDone);

    await events.type(screen.getByLabelText(/^Internal reason/), ' Lost chargeback ');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledExactlyOnceWith('/v1/admin/bookings/{id}/reverse-transfer', {
        params: { path: { id: 'booking-1' } },
        body: { reason: 'Lost chargeback', expectedReversedCents: 1000 },
      });
    });
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
  });

  it('requires a reason', async () => {
    const events = await openDialog();

    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    expect(await screen.findByText('Give a reason for the audit log.')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it.each([
    ['UNPROCESSABLE_ENTITY', /Nothing is left on the transfer/],
    ['TOO_MANY_REQUESTS', /Too many admin changes/],
    ['FORBIDDEN', "You don't have permission to do this."],
    ['NOT_FOUND', "This booking couldn't be found."],
    ['VALIDATION_ERROR', "That request wasn't valid."],
  ])('shows the mapped message for %s', async (code, text) => {
    postMock.mockResolvedValueOnce(failure(code, 422));
    const events = await openDialog();

    await events.type(screen.getByLabelText(/^Internal reason/), 'x');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('shows no error text on TWO_FACTOR_REQUIRED', async () => {
    postMock.mockResolvedValueOnce(failure('TWO_FACTOR_REQUIRED', 401));
    const events = await openDialog();

    await events.type(screen.getByLabelText(/^Internal reason/), 'x');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByText(/couldn't be completed/)).not.toBeInTheDocument();
  });

  it('disables submit in flight and does not retry', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    postMock.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const events = await openDialog();

    await events.type(screen.getByLabelText(/^Internal reason/), 'x');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    const pending = await screen.findByRole('button', { name: 'Reversing...' });
    expect(pending).toBeDisabled();
    await events.click(pending);
    expect(postMock).toHaveBeenCalledTimes(1);
    resolve({ data: {}, response: { ok: true, status: 200 } });
  });

  it('shows the server message verbatim on CONFLICT, not the generic state message', async () => {
    const message = 'Money lock held, retry shortly';
    postMock.mockResolvedValueOnce(failure('CONFLICT', 409, message));
    const events = await openDialog();

    await events.type(screen.getByLabelText(/^Internal reason/), 'x');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    expect(await screen.findByText(/not made because of a conflict/)).toHaveTextContent(message);
    expect(screen.queryByText(/no longer in a state/)).not.toBeInTheDocument();
  });

  it('shows a distinct message when the money lock is held', async () => {
    postMock.mockResolvedValueOnce(failure('BOOKING_BUSY'));
    const events = await openDialog();

    await events.type(screen.getByLabelText(/^Internal reason/), 'reason');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    expect(await screen.findByText(/still running/)).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('names the booking state when it does not allow a reversal', async () => {
    postMock.mockResolvedValueOnce({
      error: { code: 'BOOKING_STATE', details: { status: 'paid_held' } },
      response: { ok: false, status: 409 },
    });
    const events = await openDialog();

    await events.type(screen.getByLabelText(/^Internal reason/), 'reason');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    expect(await screen.findByText(/This booking is "Paid, held"/)).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('shows the reload message on LEDGER_CHANGED and does not retry', async () => {
    postMock.mockResolvedValueOnce(failure('LEDGER_CHANGED', 409, 'ledger moved'));
    const onUnknownOutcome = vi.fn();
    const events = await openDialog(vi.fn(), onUnknownOutcome);

    await events.type(screen.getByLabelText(/^Internal reason/), 'x');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    expect(await screen.findByText(/changed since you opened it/)).toBeInTheDocument();
    expect(screen.queryByText(/not made because of a conflict/)).not.toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(onUnknownOutcome).not.toHaveBeenCalled();
  });

  it.each([
    ['a thrown network error', () => Promise.reject(new TypeError('network'))],
    ['an HTTP 500', () => Promise.resolve(failure('INTERNAL_SERVER_ERROR', 500))],
    ['an empty-bodied HTTP 503', () => Promise.resolve({ response: { ok: false, status: 503 } })],
  ])('closes and reports an unknown outcome on %s', async (_name, outcome) => {
    postMock.mockImplementationOnce(outcome);
    const onDone = vi.fn();
    const onUnknownOutcome = vi.fn();
    const events = await openDialog(onDone, onUnknownOutcome);

    await events.type(screen.getByLabelText(/^Internal reason/), 'x');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    await waitFor(() => {
      expect(onUnknownOutcome).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('cannot be cancelled or dismissed while the request is in flight', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    postMock.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const events = await openDialog();

    await events.type(screen.getByLabelText(/^Internal reason/), 'x');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));
    await screen.findByRole('button', { name: 'Reversing...' });

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await events.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    resolve(failure('UNPROCESSABLE_ENTITY', 422));
    expect(await screen.findByText(/Nothing is left on the transfer/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('shows no error text on a 401 without a two-factor code', async () => {
    postMock.mockResolvedValueOnce({
      error: { code: 'UNAUTHORIZED' },
      response: { ok: false, status: 401 },
    });
    const events = await openDialog();

    await events.type(screen.getByLabelText(/^Internal reason/), 'x');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
