import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseFormatter, mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations, useFormatter: mockUseFormatter };
});

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

async function openDialog(onDone = vi.fn(), currency = 'EUR') {
  const { RefundDialog } = await import('./refund-dialog');
  const events = userEvent.setup();
  render(
    <RefundDialog
      bookingId="booking-1"
      currency={currency}
      refundableCents={9000}
      onDone={onDone}
    />,
  );
  await events.click(screen.getByRole('button', { name: 'Refund after release' }));
  return events;
}

async function fill(events: ReturnType<typeof userEvent.setup>, amount: string, reason: string) {
  if (amount) {
    await events.type(screen.getByLabelText(/^Amount/), amount);
  }
  await events.type(screen.getByLabelText(/^Internal reason/), reason);
}

beforeEach(() => {
  postMock.mockReset();
});

describe('RefundDialog', () => {
  it('warns about the second factor and shows the refundable hint before submit', async () => {
    await openDialog();

    expect(screen.getByText(/asks for your second factor again/)).toBeInTheDocument();
    expect(screen.getByText(/Up to €90.00 looks refundable/)).toBeInTheDocument();
    expect(screen.getByText(/audit log only/)).toBeInTheDocument();
  });

  it('names the booking, amount and currency once the amount is valid', async () => {
    const events = await openDialog();

    await events.type(screen.getByLabelText(/^Amount/), '12.34');

    expect(
      screen.getByText('You are about to refund €12.34 (EUR) on booking booking-1.'),
    ).toBeInTheDocument();
  });

  it('sends exactly the exact cents and trimmed reason', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'booking-1' } });
    const onDone = vi.fn();
    const events = await openDialog(onDone);

    await fill(events, '12.34', '  Photographer no-show  ');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledExactlyOnceWith('/v1/admin/bookings/{id}/refund', {
        params: { path: { id: 'booking-1' } },
        body: { amountCents: 1234, reason: 'Photographer no-show' },
      });
    });
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
    });
  });

  it('converts a float-trap amount without rounding error', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'booking-1' } });
    const events = await openDialog();

    await fill(events, '0.30', 'x');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/v1/admin/bookings/{id}/refund',
        expect.objectContaining({ body: { amountCents: 30, reason: 'x' } }),
      );
    });
  });

  it('uses the currency minor unit', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'booking-1' } });
    const events = await openDialog(vi.fn(), 'JPY');

    await fill(events, '500', 'x');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/v1/admin/bookings/{id}/refund',
        expect.objectContaining({ body: { amountCents: 500, reason: 'x' } }),
      );
    });
  });

  it.each([
    ['12.345', /at most 2 decimal places/],
    ['0', /greater than zero/],
    ['-5', /greater than zero/],
    ['abc', /Enter an amount like 12.34/],
    ['', /Enter an amount like 12.34/],
  ])('rejects the amount %j without calling the API', async (amount, message) => {
    const events = await openDialog();

    await fill(events, amount, 'reason');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('requires a reason', async () => {
    const events = await openDialog();

    await fill(events, '5', '   ');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    expect(await screen.findByText('Give a reason for the audit log.')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('rejects a reason over 2000 characters', async () => {
    const events = await openDialog();

    await events.type(screen.getByLabelText(/^Amount/), '5');
    await events.click(screen.getByLabelText(/^Internal reason/));
    await events.paste('a'.repeat(2001));
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    expect(await screen.findByText(/The reason is too long/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it.each([
    ['UNPROCESSABLE_ENTITY', /more than can still be refunded/],
    ['CONFLICT', /no longer in a state that allows that/],
    ['TOO_MANY_REQUESTS', /Too many admin changes/],
    ['VALIDATION_ERROR', "That request wasn't valid."],
    ['FORBIDDEN', "You don't have permission to do this."],
    ['NOT_FOUND', "This booking couldn't be found."],
    ['SOMETHING_ELSE', /couldn't be completed/],
  ])('shows the mapped message for %s and keeps the dialog open', async (code, text) => {
    postMock.mockResolvedValueOnce({ error: { code } });
    const onDone = vi.fn();
    const events = await openDialog(onDone);

    await fill(events, '5', 'reason');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows a generic message when the request throws and does not retry', async () => {
    postMock.mockRejectedValueOnce(new TypeError('network'));
    const events = await openDialog();

    await fill(events, '5', 'reason');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    expect(await screen.findByText(/Reload to check the ledger sums/)).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('shows no error text when the API asks for two-factor re-verification', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
    const onDone = vi.fn();
    const events = await openDialog(onDone);

    await fill(events, '5', 'reason');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled();
    });
    expect(screen.queryByText(/couldn't be completed/)).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('disables submit while in flight and sends only one request', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    postMock.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const events = await openDialog();

    await fill(events, '5', 'reason');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    const pending = await screen.findByRole('button', { name: 'Refunding...' });
    expect(pending).toBeDisabled();
    await events.click(pending);
    expect(postMock).toHaveBeenCalledTimes(1);

    resolve({ data: { id: 'booking-1' } });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('clears the draft when the dialog is cancelled', async () => {
    const events = await openDialog();

    await fill(events, '5', 'reason');
    await events.click(screen.getByRole('button', { name: 'Cancel' }));
    await events.click(screen.getByRole('button', { name: 'Refund after release' }));

    expect(screen.getByLabelText(/^Amount/)).toHaveValue('');
  });

  it('still sends an amount above the refundable hint because the API is authoritative', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'booking-1' } });
    const events = await openDialog();

    await fill(events, '90.01', 'over the hint');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/v1/admin/bookings/{id}/refund',
        expect.objectContaining({ body: { amountCents: 9001, reason: 'over the hint' } }),
      );
    });
  });

  it('accepts a comma decimal separator', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'booking-1' } });
    const events = await openDialog();

    await fill(events, '12,34', 'x');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        '/v1/admin/bookings/{id}/refund',
        expect.objectContaining({ body: { amountCents: 1234, reason: 'x' } }),
      );
    });
  });

  it('does not send a whitespace-only reason even with a valid amount', async () => {
    const events = await openDialog();

    await fill(events, '5', ' \t ');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    expect(await screen.findByText('Give a reason for the audit log.')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the dialog and reports done exactly once on success', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'booking-1' } });
    const onDone = vi.fn();
    const events = await openDialog(onDone);

    await fill(events, '5', 'reason');
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('sends one request when the submit button is double clicked', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    postMock.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const events = await openDialog();

    await fill(events, '5', 'reason');
    await events.dblClick(screen.getByRole('button', { name: 'Refund' }));

    expect(postMock).toHaveBeenCalledTimes(1);
    resolve({ data: { id: 'booking-1' } });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('allows a retry after a failed request', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'CONFLICT' } });
    postMock.mockResolvedValueOnce({ data: { id: 'booking-1' } });
    const events = await openDialog();

    await fill(events, '5', 'reason');
    await events.click(screen.getByRole('button', { name: 'Refund' }));
    await screen.findByText(/no longer in a state that allows that/);
    await events.click(screen.getByRole('button', { name: 'Refund' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(2);
    });
  });
});
