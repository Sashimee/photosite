import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';

jest.mock('../../lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../lib/i18n';
import { api } from '../../lib/api';
import type { Booking } from '../../lib/booking-status';
import { makeBooking } from '../../testing/booking-fixtures';
import { BookingRefund } from './booking-refund';

const mockedPost = jest.mocked(api.POST);

function reply(status: number, body: object) {
  return Promise.resolve({
    data: status < 300 ? body : undefined,
    error: status < 300 ? undefined : body,
    response: new Response(null, { status }),
  });
}

function refundResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: 'partially_refunded',
    amount: { amountCents: 2500, currency: 'EUR' },
    refundedTotal: { amountCents: 2500, currency: 'EUR' },
    booking: makeBooking('b1', { status: 'in_progress' }),
    ...overrides,
  };
}

function Harness({ initial, onChanged }: { initial: Booking; onChanged: (b: Booking) => void }) {
  const [booking, setBooking] = useState(initial);
  return (
    <BookingRefund
      booking={booking}
      onBookingChanged={(next) => {
        onChanged(next);
        setBooking(next);
      }}
    />
  );
}

function renderRefund(status = 'paid_held') {
  const onChanged = jest.fn();
  render(
    <Harness initial={makeBooking('b1', { status }) as unknown as Booking} onChanged={onChanged} />,
  );
  return onChanged;
}

function fill(amount: string, reason = 'Photos never arrived') {
  fireEvent.press(screen.getByTestId('booking-refund'));
  fireEvent.changeText(screen.getByTestId('booking-refund-amount'), amount);
  fireEvent.changeText(screen.getByTestId('booking-refund-reason'), reason);
  fireEvent.press(screen.getByTestId('booking-refund-submit'));
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('BookingRefund', () => {
  it.each(['paid_held', 'in_progress', 'delivered'])('is offered in %s', (status) => {
    renderRefund(status);
    expect(screen.getByTestId('booking-refund')).toBeTruthy();
  });

  it.each(['pending_payment', 'released', 'refunded', 'cancelled', 'disputed'])(
    'renders nothing in %s',
    (status) => {
      renderRefund(status);
      expect(screen.queryByTestId('booking-refund')).toBeNull();
    },
  );

  it('sends a partial refund as integer cents and re-renders from the returned booking', async () => {
    mockedPost.mockReturnValue(reply(200, refundResponse()));
    const onChanged = renderRefund();
    fill('25');

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith(makeBooking('b1', { status: 'in_progress' }));
    });
    expect(mockedPost).toHaveBeenCalledWith('/v1/bookings/{id}/refund', {
      params: { path: { id: 'b1' } },
      body: { amountCents: 2500, reason: 'Photos never arrived' },
    });
    expect(screen.getByTestId('booking-refund-done')).toHaveTextContent(
      /Refund of €25\.00 recorded\. Refunded so far: €25\.00\..*scheduled release still goes ahead with the reduced amount/,
    );
    expect(screen.getByTestId('booking-refund')).toBeTruthy();
  });

  it('accepts a decimal comma and omits the amount for a full refund', async () => {
    mockedPost.mockReturnValue(reply(200, refundResponse()));
    renderRefund();
    fill('12,5');
    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledTimes(1);
    });
    expect(mockedPost.mock.calls[0]?.[1]).toMatchObject({ body: { amountCents: 1250 } });
  });

  it('omits amountCents when the amount is empty and keeps the confirmation after a full refund', async () => {
    mockedPost.mockReturnValue(
      reply(
        200,
        refundResponse({
          status: 'refunded',
          amount: { amountCents: 157777, currency: 'EUR' },
          refundedTotal: { amountCents: 157777, currency: 'EUR' },
          booking: makeBooking('b1', { status: 'refunded' }),
        }),
      ),
    );
    renderRefund('delivered');
    fill('');

    expect(await screen.findByTestId('booking-refund-done')).toHaveTextContent(
      'Refund of €1,577.77 recorded. The booking is now refunded in full.',
    );
    expect(mockedPost).toHaveBeenCalledWith('/v1/bookings/{id}/refund', {
      params: { path: { id: 'b1' } },
      body: { reason: 'Photos never arrived' },
    });
    expect(screen.queryByTestId('booking-refund')).toBeNull();
  });

  it.each(['19.999', '0', '0.00', '-5', 'abc', '1e3'])(
    'rejects the amount %j without a request',
    (amount) => {
      renderRefund();
      fill(amount);

      expect(screen.getByText(/at most 2 decimal places/)).toBeTruthy();
      expect(mockedPost).not.toHaveBeenCalled();
    },
  );

  it('requires a reason', () => {
    renderRefund();
    fill('10', '   ');

    expect(screen.getByText('This field is required.')).toBeTruthy();
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('maps BOOKING_BUSY to a retry message and keeps the form for another try', async () => {
    mockedPost.mockReturnValue(reply(409, { code: 'BOOKING_BUSY' }));
    const onChanged = renderRefund();
    fill('10');

    expect(await screen.findByTestId('booking-refund-error')).toHaveTextContent(
      /Try again in a moment/,
    );
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId('booking-refund-submit')).toBeTruthy();
  });

  it.each([
    [409, { code: 'CONFLICT' }, /can't be refunded right now/],
    [422, { code: 'UNPROCESSABLE_ENTITY' }, /more than what's still refundable/],
    [429, { code: 'TOO_MANY_REQUESTS' }, /too fast/],
    [403, { code: 'FORBIDDEN' }, /Only the client/],
    [404, { code: 'NOT_FOUND' }, /could not be found/],
  ])('maps %i to its message', async (status, body, message) => {
    mockedPost.mockReturnValue(reply(status, body));
    renderRefund();
    fill('10');

    expect(await screen.findByTestId('booking-refund-error')).toHaveTextContent(message);
  });

  it('shows the generic error when the request throws', async () => {
    mockedPost.mockRejectedValue(new Error('offline'));
    renderRefund();
    fill('10');

    expect(await screen.findByTestId('booking-refund-error')).toHaveTextContent(
      /Something went wrong/,
    );
  });

  it('sends one request for a double submit', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderRefund();
    fill('10');
    fireEvent.press(screen.getByTestId('booking-refund-submit'));
    expect(mockedPost).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({
        data: refundResponse(),
        error: undefined,
        response: new Response(null, { status: 200 }),
      });
      await Promise.resolve();
    });
  });

  it('closes the form on dismiss without a request', () => {
    renderRefund();
    fireEvent.press(screen.getByTestId('booking-refund'));
    fireEvent.press(screen.getByTestId('booking-refund-dismiss'));

    expect(screen.queryByTestId('booking-refund-form')).toBeNull();
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
