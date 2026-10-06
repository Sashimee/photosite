import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});

const postMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: { POST: postMock } }));

async function openDialog(onDone = vi.fn()) {
  const { ReverseTransferDialog } = await import('./reverse-transfer-dialog');
  const events = userEvent.setup();
  render(<ReverseTransferDialog bookingId="booking-1" currency="EUR" onDone={onDone} />);
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
    expect(screen.getByText(/The client is not refunded/)).toBeInTheDocument();
  });

  it('sends exactly the trimmed reason', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'booking-1' } });
    const onDone = vi.fn();
    const events = await openDialog(onDone);

    await events.type(screen.getByLabelText(/^Internal reason/), ' Lost chargeback ');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledExactlyOnceWith('/v1/admin/bookings/{id}/reverse-transfer', {
        params: { path: { id: 'booking-1' } },
        body: { reason: 'Lost chargeback' },
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
    ['CONFLICT', /no longer in a state that allows that/],
    ['TOO_MANY_REQUESTS', /Too many admin changes/],
    ['FORBIDDEN', "You don't have permission to do this."],
    ['NOT_FOUND', "This booking couldn't be found."],
    ['VALIDATION_ERROR', "That request wasn't valid."],
  ])('shows the mapped message for %s', async (code, text) => {
    postMock.mockResolvedValueOnce({ error: { code } });
    const events = await openDialog();

    await events.type(screen.getByLabelText(/^Internal reason/), 'x');
    await events.click(screen.getByRole('button', { name: 'Reverse transfer' }));

    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('shows no error text on TWO_FACTOR_REQUIRED', async () => {
    postMock.mockResolvedValueOnce({ error: { code: 'TWO_FACTOR_REQUIRED' } });
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
    resolve({ data: {} });
  });
});
