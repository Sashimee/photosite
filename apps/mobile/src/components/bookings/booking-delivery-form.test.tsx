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
import { BookingDeliveryForm } from './booking-delivery-form';

const mockedPost = jest.mocked(api.POST);

function reply(status: number, body: object) {
  return Promise.resolve({
    data: status < 300 ? body : undefined,
    error: status < 300 ? undefined : body,
    response: new Response(null, { status }),
  });
}

function renderForm(status = 'paid_held') {
  const onDelivered = jest.fn();
  render(
    <BookingDeliveryForm
      booking={makeBooking('b1', { status }) as unknown as Booking}
      onDelivered={onDelivered}
    />,
  );
  return onDelivered;
}

function fill(message: string, link: string) {
  fireEvent.changeText(screen.getByTestId('booking-delivery-message'), message);
  fireEvent.changeText(screen.getByTestId('booking-delivery-link'), link);
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('BookingDeliveryForm', () => {
  it.each(['paid_held', 'in_progress'])('posts the delivery in %s', async (status) => {
    mockedPost.mockReturnValue(reply(201, { delivery: { id: 'd1' } }));
    const onDelivered = renderForm(status);

    fill(' Your photos ', ' https://files.example.com/x ');
    fireEvent.press(screen.getByTestId('booking-delivery-submit'));

    await waitFor(() => {
      expect(onDelivered).toHaveBeenCalledTimes(1);
    });
    expect(mockedPost).toHaveBeenCalledWith('/v1/bookings/{id}/delivery', {
      params: { path: { id: 'b1' } },
      body: { message: 'Your photos', externalLink: 'https://files.example.com/x' },
    });
  });

  it.each(['pending_payment', 'delivered', 'released', 'refunded', 'cancelled', 'disputed'])(
    'renders nothing in %s',
    (status) => {
      renderForm(status);
      expect(screen.queryByTestId('booking-delivery-form')).toBeNull();
    },
  );

  it('rejects empty fields without calling the API', () => {
    renderForm();
    fireEvent.press(screen.getByTestId('booking-delivery-submit'));

    expect(screen.getAllByText('This field is required.')).toHaveLength(2);
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it.each(['http://files.example.com/x', 'not a link', 'ftp://files.example.com/x'])(
    'rejects the link %s',
    (link) => {
      renderForm();
      fill('Done', link);
      fireEvent.press(screen.getByTestId('booking-delivery-submit'));

      expect(screen.getByText('Enter a valid link starting with https://.')).toBeTruthy();
      expect(mockedPost).not.toHaveBeenCalled();
    },
  );

  it('rejects a message over 2000 characters', () => {
    renderForm();
    fill('a'.repeat(2001), 'https://files.example.com/x');
    fireEvent.press(screen.getByTestId('booking-delivery-submit'));

    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.queryByText('This field is required.')).toBeNull();
  });

  it('sends one request for a double tap', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const onDelivered = renderForm();
    fill('Done', 'https://files.example.com/x');

    fireEvent.press(screen.getByTestId('booking-delivery-submit'));
    fireEvent.press(screen.getByTestId('booking-delivery-submit'));
    expect(mockedPost).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({
        data: { delivery: { id: 'd1' } },
        error: undefined,
        response: new Response(null, { status: 201 }),
      });
      await Promise.resolve();
    });
    expect(onDelivered).toHaveBeenCalledTimes(1);
  });

  it('maps 409 to the conflict message', async () => {
    mockedPost.mockReturnValue(reply(409, { code: 'CONFLICT' }));
    const onDelivered = renderForm();
    fill('Done', 'https://files.example.com/x');
    fireEvent.press(screen.getByTestId('booking-delivery-submit'));

    expect(await screen.findByTestId('booking-delivery-error')).toHaveTextContent(
      /can't take a delivery right now/,
    );
    expect(onDelivered).not.toHaveBeenCalled();
  });

  it('maps a 400 validation error', async () => {
    mockedPost.mockReturnValue(reply(400, { code: 'VALIDATION_ERROR' }));
    renderForm();
    fill('Done', 'https://files.example.com/x');
    fireEvent.press(screen.getByTestId('booking-delivery-submit'));

    expect(await screen.findByTestId('booking-delivery-error')).toHaveTextContent(
      /Check the message and the link/,
    );
  });

  it('shows the generic error when the request throws, and allows a retry', async () => {
    mockedPost.mockRejectedValueOnce(new Error('offline'));
    mockedPost.mockReturnValueOnce(reply(201, { delivery: { id: 'd1' } }));
    const onDelivered = renderForm();
    fill('Done', 'https://files.example.com/x');
    fireEvent.press(screen.getByTestId('booking-delivery-submit'));

    expect(await screen.findByTestId('booking-delivery-error')).toHaveTextContent(
      /Something went wrong/,
    );
    fireEvent.press(screen.getByTestId('booking-delivery-submit'));
    await waitFor(() => {
      expect(onDelivered).toHaveBeenCalledTimes(1);
    });
  });
});
