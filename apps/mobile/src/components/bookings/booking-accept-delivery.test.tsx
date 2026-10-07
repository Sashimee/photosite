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
import { BookingAcceptDelivery } from './booking-accept-delivery';

const mockedPost = jest.mocked(api.POST);

function reply(status: number, body: object) {
  return Promise.resolve({
    data: status < 300 ? body : undefined,
    error: status < 300 ? undefined : body,
    response: new Response(null, { status }),
  });
}

function renderButton(status = 'delivered') {
  const onBookingChanged = jest.fn();
  render(
    <BookingAcceptDelivery
      booking={makeBooking('b1', { status }) as unknown as Booking}
      onBookingChanged={onBookingChanged}
    />,
  );
  return onBookingChanged;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('BookingAcceptDelivery', () => {
  it('asks for confirmation, mentioning release and the chat link, before posting', async () => {
    const released = makeBooking('b1', { status: 'released' });
    mockedPost.mockReturnValue(reply(200, released));
    const onBookingChanged = renderButton();

    fireEvent.press(screen.getByTestId('booking-accept-delivery'));
    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByText(/releases the payment to the photographer/)).toBeTruthy();
    expect(screen.getByText(/link the photographer sent you in chat/)).toBeTruthy();

    fireEvent.press(screen.getByTestId('booking-accept-delivery-confirm'));

    await waitFor(() => {
      expect(onBookingChanged).toHaveBeenCalledWith(released);
    });
    expect(mockedPost).toHaveBeenCalledWith('/v1/bookings/{id}/accept-delivery', {
      params: { path: { id: 'b1' } },
    });
    expect(screen.getByTestId('booking-accept-delivery-done')).toBeTruthy();
  });

  it('does not post when the confirm is dismissed', () => {
    renderButton();
    fireEvent.press(screen.getByTestId('booking-accept-delivery'));
    fireEvent.press(screen.getByTestId('booking-accept-delivery-dismiss'));

    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByTestId('booking-accept-delivery')).toBeTruthy();
  });

  it.each(['pending_payment', 'paid_held', 'in_progress', 'released', 'refunded', 'disputed'])(
    'renders nothing in %s',
    (status) => {
      renderButton(status);
      expect(screen.queryByTestId('booking-accept-delivery')).toBeNull();
    },
  );

  it('sends one request for a double confirm', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderButton();
    fireEvent.press(screen.getByTestId('booking-accept-delivery'));
    fireEvent.press(screen.getByTestId('booking-accept-delivery-confirm'));
    fireEvent.press(screen.getByTestId('booking-accept-delivery-confirm'));
    expect(mockedPost).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({
        data: makeBooking('b1', { status: 'delivered' }),
        error: undefined,
        response: new Response(null, { status: 200 }),
      });
      await Promise.resolve();
    });
  });

  it('maps 409 to the conflict message and keeps the button for a retry', async () => {
    mockedPost.mockReturnValue(reply(409, { code: 'CONFLICT' }));
    const onBookingChanged = renderButton();
    fireEvent.press(screen.getByTestId('booking-accept-delivery'));
    fireEvent.press(screen.getByTestId('booking-accept-delivery-confirm'));

    expect(await screen.findByTestId('booking-accept-delivery-error')).toHaveTextContent(
      /can't be accepted right now/,
    );
    expect(onBookingChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId('booking-accept-delivery')).toBeTruthy();
  });

  it('shows the generic error when the request throws', async () => {
    mockedPost.mockRejectedValue(new Error('offline'));
    renderButton();
    fireEvent.press(screen.getByTestId('booking-accept-delivery'));
    fireEvent.press(screen.getByTestId('booking-accept-delivery-confirm'));

    expect(await screen.findByTestId('booking-accept-delivery-error')).toHaveTextContent(
      /Something went wrong/,
    );
  });
});
