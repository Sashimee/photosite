import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('../../lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

import '../../lib/i18n';
import * as WebBrowser from 'expo-web-browser';

import { api } from '../../lib/api';
import type { Booking } from '../../lib/booking-status';
import { makeBooking } from '../../testing/booking-fixtures';
import { BookingDocumentButton } from './booking-document-button';

const mockedGet = jest.mocked(api.GET);
const mockedOpen = jest.mocked(WebBrowser.openBrowserAsync);

const URL = 'https://storage.photoo.lu/bookings/b1/receipt.pdf?signature=xyz';

function reply(status: number, body: object) {
  return Promise.resolve({
    data: status < 300 ? body : undefined,
    error: status < 300 ? undefined : body,
    response: new Response(null, { status }),
  });
}

function renderButton(document: 'receipt' | 'fee-invoice', status = 'released') {
  render(
    <BookingDocumentButton
      booking={makeBooking('b1', { status }) as unknown as Booking}
      document={document}
    />,
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedOpen.mockResolvedValue({ type: 'opened' } as never);
});

describe('BookingDocumentButton', () => {
  it('fetches the presigned URL on tap and opens it in the browser', async () => {
    mockedGet.mockReturnValue(reply(200, { url: URL, expiresAt: '2027-01-01T12:10:00.000Z' }));
    renderButton('receipt');
    expect(mockedGet).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('booking-document-receipt'));

    await waitFor(() => {
      expect(mockedOpen).toHaveBeenCalledWith(URL);
    });
    expect(mockedGet).toHaveBeenCalledWith('/v1/bookings/{id}/documents/{document}', {
      params: { path: { id: 'b1', document: 'receipt' } },
    });
  });

  it('labels and requests the fee invoice', async () => {
    mockedGet.mockReturnValue(reply(200, { url: URL, expiresAt: '2027-01-01T12:10:00.000Z' }));
    renderButton('fee-invoice');

    expect(screen.getByText('Download fee invoice')).toBeTruthy();
    fireEvent.press(screen.getByTestId('booking-document-fee-invoice'));
    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledWith('/v1/bookings/{id}/documents/{document}', {
        params: { path: { id: 'b1', document: 'fee-invoice' } },
      });
    });
  });

  it.each(['http://storage.photoo.lu/receipt.pdf', 'javascript:alert(1)', 'not a url'])(
    'refuses to open %s',
    async (url) => {
      mockedGet.mockReturnValue(reply(200, { url, expiresAt: '2027-01-01T12:10:00.000Z' }));
      renderButton('receipt');
      fireEvent.press(screen.getByTestId('booking-document-receipt'));

      expect(await screen.findByTestId('booking-document-receipt-error')).toHaveTextContent(
        /couldn't open the document/,
      );
      expect(mockedOpen).not.toHaveBeenCalled();
    },
  );

  it.each([
    [409, { code: 'CONFLICT' }, /being prepared/],
    [403, { code: 'FORBIDDEN' }, /don't have access/],
    [404, { code: 'NOT_FOUND' }, /could not be found/],
  ])('maps %i to its message', async (status, body, message) => {
    mockedGet.mockReturnValue(reply(status, body));
    renderButton('receipt');
    fireEvent.press(screen.getByTestId('booking-document-receipt'));

    expect(await screen.findByTestId('booking-document-receipt-error')).toHaveTextContent(message);
    expect(mockedOpen).not.toHaveBeenCalled();
  });

  it('shows the generic error when the browser fails to open', async () => {
    mockedGet.mockReturnValue(reply(200, { url: URL, expiresAt: '2027-01-01T12:10:00.000Z' }));
    mockedOpen.mockRejectedValue(new Error('no browser'));
    renderButton('receipt');
    fireEvent.press(screen.getByTestId('booking-document-receipt'));

    expect(await screen.findByTestId('booking-document-receipt-error')).toHaveTextContent(
      /couldn't open the document/,
    );
  });

  it('requests once for a double tap', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockedGet.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderButton('receipt');
    fireEvent.press(screen.getByTestId('booking-document-receipt'));
    fireEvent.press(screen.getByTestId('booking-document-receipt'));
    expect(mockedGet).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish({
        data: { url: URL, expiresAt: '2027-01-01T12:10:00.000Z' },
        error: undefined,
        response: new Response(null, { status: 200 }),
      });
      await Promise.resolve();
    });
  });

  it.each([
    'pending_payment',
    'paid_held',
    'in_progress',
    'delivered',
    'refunded',
    'cancelled',
    'disputed',
  ])('renders nothing in %s', (status) => {
    renderButton('receipt', status);
    expect(screen.queryByTestId('booking-document-receipt')).toBeNull();
  });
});
