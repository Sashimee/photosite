import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('../../lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../lib/i18n';
import { api } from '../../lib/api';
import type { Booking } from '../../lib/booking-status';
import { makeBooking } from '../../testing/booking-fixtures';
import { BookingCancel } from './booking-cancel';

const mockedPost = jest.mocked(api.POST);

function reply(status: number, body: object) {
  return Promise.resolve({
    data: status < 300 ? body : undefined,
    error: status < 300 ? undefined : body,
    response: new Response(null, { status }),
  });
}

function renderCancel(status = 'pending_payment') {
  const onBookingChanged = jest.fn();
  render(
    <BookingCancel
      booking={makeBooking('b1', { status }) as unknown as Booking}
      onBookingChanged={onBookingChanged}
    />,
  );
  return onBookingChanged;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('BookingCancel', () => {
  it('confirms first, then cancels with no reason and hands over the returned booking', async () => {
    const cancelled = makeBooking('b1', { status: 'cancelled' });
    mockedPost.mockReturnValue(reply(200, cancelled));
    const onBookingChanged = renderCancel();

    fireEvent.press(screen.getByTestId('booking-cancel'));
    expect(mockedPost).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('booking-cancel-confirm'));

    await waitFor(() => {
      expect(onBookingChanged).toHaveBeenCalledWith(cancelled);
    });
    expect(mockedPost).toHaveBeenCalledWith('/v1/bookings/{id}/cancel', {
      params: { path: { id: 'b1' } },
      body: {},
    });
  });

  it('sends the trimmed reason', async () => {
    mockedPost.mockReturnValue(reply(200, makeBooking('b1', { status: 'cancelled' })));
    renderCancel();
    fireEvent.press(screen.getByTestId('booking-cancel'));
    fireEvent.changeText(screen.getByTestId('booking-cancel-reason'), '  Plans changed ');
    fireEvent.press(screen.getByTestId('booking-cancel-confirm'));

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });
    expect(mockedPost.mock.calls[0]?.[1]).toMatchObject({ body: { reason: 'Plans changed' } });
  });

  it('does not post when dismissed', () => {
    renderCancel();
    fireEvent.press(screen.getByTestId('booking-cancel'));
    fireEvent.press(screen.getByTestId('booking-cancel-dismiss'));

    expect(mockedPost).not.toHaveBeenCalled();
  });

  it.each([
    'paid_held',
    'in_progress',
    'delivered',
    'released',
    'refunded',
    'cancelled',
    'disputed',
  ])('renders nothing in %s', (status) => {
    renderCancel(status);
    expect(screen.queryByTestId('booking-cancel')).toBeNull();
  });

  it('rejects a reason over 2000 characters without a request', async () => {
    renderCancel();
    fireEvent.press(screen.getByTestId('booking-cancel'));
    fireEvent.changeText(screen.getByTestId('booking-cancel-reason'), 'x'.repeat(2001));
    fireEvent.press(screen.getByTestId('booking-cancel-confirm'));

    expect(await screen.findByTestId('booking-cancel-error')).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('sends one request for a double confirm', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderCancel();
    fireEvent.press(screen.getByTestId('booking-cancel'));
    fireEvent.press(screen.getByTestId('booking-cancel-confirm'));
    fireEvent.press(screen.getByTestId('booking-cancel-confirm'));
    expect(mockedPost).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({
        data: makeBooking('b1', { status: 'cancelled' }),
        error: undefined,
        response: new Response(null, { status: 200 }),
      });
      await Promise.resolve();
    });
  });

  it.each([
    [409, { code: 'CONFLICT' }, /can't be cancelled anymore/],
    [400, { code: 'VALIDATION_ERROR' }, /Check the reason/],
    [403, { code: 'FORBIDDEN' }, /don't have access/],
    [404, { code: 'NOT_FOUND' }, /could not be found/],
  ])('maps %i to its message', async (status, body, message) => {
    mockedPost.mockReturnValue(reply(status, body));
    const onBookingChanged = renderCancel();
    fireEvent.press(screen.getByTestId('booking-cancel'));
    fireEvent.press(screen.getByTestId('booking-cancel-confirm'));

    expect(await screen.findByTestId('booking-cancel-error')).toHaveTextContent(message);
    expect(onBookingChanged).not.toHaveBeenCalled();
  });

  it('shows the generic error when the request throws', async () => {
    mockedPost.mockRejectedValue(new Error('offline'));
    renderCancel();
    fireEvent.press(screen.getByTestId('booking-cancel'));
    fireEvent.press(screen.getByTestId('booking-cancel-confirm'));

    expect(await screen.findByTestId('booking-cancel-error')).toHaveTextContent(
      /Something went wrong/,
    );
  });
});
