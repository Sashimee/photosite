import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../src/lib/use-unread-count', () => ({ useUnreadCount: () => 0 }));

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { id: 'c1', roles: ['client'] } }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../src/lib/i18n';
import { api } from '../../src/lib/api';
import { makeBooking } from '../../src/testing/booking-fixtures';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);

function ok(data: unknown) {
  return Promise.resolve({ data, error: undefined, response: new Response(null, { status: 200 }) });
}

function failed(status: number) {
  return Promise.resolve({ data: undefined, error: {}, response: new Response(null, { status }) });
}

function page(items: object[], nextCursor: string | null = null) {
  return ok({ items, nextCursor });
}

function open(url: string) {
  return renderRouter('./app', { initialUrl: url });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('client bookings list', () => {
  it('shows only bookings where the user is the client', async () => {
    mockedGet.mockReturnValue(
      page([
        makeBooking('b1'),
        makeBooking('b2', { clientId: 'c-other', photographerId: 'p-self' }),
        makeBooking('b3', { status: 'delivered' }),
      ]),
    );
    open('/bookings');

    await screen.findByTestId('booking-card-b1');
    expect(screen.getByTestId('booking-card-b3')).toBeTruthy();
    expect(screen.queryByTestId('booking-card-b2')).toBeNull();
    expect(screen.getByText('Awaiting payment')).toBeTruthy();
    expect(screen.getByText('Delivered')).toBeTruthy();
    expect(screen.getAllByText('€1,577.77')).toHaveLength(2);
  });

  it('shows an empty state', async () => {
    mockedGet.mockReturnValue(page([]));
    open('/bookings');

    await screen.findByTestId('bookings-empty');
  });

  it('keeps fetching pages while the visible list is empty and more pages exist', async () => {
    mockedGet
      .mockReturnValueOnce(page([makeBooking('x1', { clientId: 'c-other' })], 'next'))
      .mockReturnValueOnce(page([makeBooking('b9')]));
    open('/bookings');

    await screen.findByTestId('booking-card-b9');
    expect(mockedGet).toHaveBeenCalledTimes(2);
    expect(mockedGet).toHaveBeenLastCalledWith(
      '/v1/bookings',
      expect.objectContaining({
        params: { query: expect.objectContaining({ cursor: 'next' }) },
      }),
    );
  });

  it('does not claim the list is empty while filtered pages are still loading', async () => {
    mockedGet.mockReturnValueOnce(page([makeBooking('x1', { clientId: 'c-other' })], 'next'));
    let finish: (value: unknown) => void = () => undefined;
    mockedGet.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    open('/bookings');

    await waitFor(() => {
      expect(mockedGet).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByTestId('bookings-empty')).toBeNull();

    finish({
      data: { items: [], nextCursor: null },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
    await screen.findByTestId('bookings-empty');
  });

  it('shows an error that retries', async () => {
    mockedGet.mockReturnValueOnce(failed(500));
    mockedGet.mockReturnValueOnce(page([makeBooking('b1')]));
    open('/bookings');

    fireEvent.press(await screen.findByTestId('bookings-retry'));

    await screen.findByTestId('booking-card-b1');
  });

  it('shows a session message on 401', async () => {
    mockedGet.mockReturnValue(failed(401));
    open('/bookings');

    await screen.findByTestId('bookings-unauthorized');
  });

  it('opens the booking from its card', async () => {
    mockedGet.mockImplementation(((path: string) =>
      path === '/v1/bookings' ? page([makeBooking('b1')]) : ok(makeBooking('b1'))) as never);
    const view = open('/bookings');

    fireEvent.press(await screen.findByTestId('booking-card-b1'));

    await screen.findByTestId('booking-detail');
    expect(view.getPathname()).toBe('/bookings/b1');
  });

  it('is reachable from the Requests tab', async () => {
    mockedGet.mockReturnValue(page([]));
    const view = open('/requests');

    fireEvent.press(await screen.findByTestId('requests-bookings'));

    await screen.findByTestId('bookings-empty');
    expect(view.getPathname()).toBe('/bookings');
  });
});

describe('client booking detail', () => {
  it('shows the total, schedule, location and the timeline position', async () => {
    mockedGet.mockReturnValue(
      ok(makeBooking('b1', { status: 'in_progress', location: { lat: 49.61, lng: 6.13 } })),
    );
    open('/bookings/b1');

    await screen.findByTestId('booking-detail');
    expect(mockedGet).toHaveBeenCalledWith('/v1/bookings/{id}', {
      params: { path: { id: 'b1' } },
    });
    expect(screen.getByTestId('booking-total').props.children).toBe('€1,577.77');
    expect(screen.getByTestId('booking-location')).toHaveTextContent('Location 49.61, 6.13');
    expect(screen.getByTestId('booking-timeline-step-in_progress').props).toMatchObject({
      accessibilityState: { selected: true },
    });
    expect(screen.queryByTestId('booking-timeline-exit')).toBeNull();
  });

  it('says there is no schedule or location when the booking has none', async () => {
    mockedGet.mockReturnValue(ok(makeBooking('b1', { scheduledAt: null })));
    open('/bookings/b1');

    await screen.findByTestId('booking-detail');
    expect(screen.getByText('Not scheduled yet')).toBeTruthy();
    expect(screen.getByTestId('booking-location')).toHaveTextContent('Location No location set');
  });

  it('shows the payment-unavailable state on pending_payment without a Stripe key and never says paid', async () => {
    mockedGet.mockReturnValue(ok(makeBooking('b1')));
    open('/bookings/b1');

    await screen.findByTestId('booking-pay-unavailable');
    expect(screen.getByText('Payment is not available in this environment')).toBeTruthy();
    expect(within(screen.getByTestId('booking-pay-panel')).queryByText(/\bpaid\b/i)).toBeNull();
    expect(api.POST).not.toHaveBeenCalled();
    expect(screen.getByTestId('booking-timeline-step-pending_payment').props).toMatchObject({
      accessibilityState: { selected: true },
    });
  });

  it('shows when payment releases on a delivered booking', async () => {
    mockedGet.mockReturnValue(
      ok(
        makeBooking('b1', {
          status: 'delivered',
          deliveredAt: '2027-01-02T10:00:00.000Z',
          releaseDueAt: '2027-01-09T10:00:00.000Z',
        }),
      ),
    );
    open('/bookings/b1');

    await screen.findByTestId('booking-release-due');
    expect(screen.getByTestId('booking-release-due')).toHaveTextContent(
      /payment is released to the photographer automatically on .*2027/,
    );
    expect(screen.queryByTestId('booking-pay-panel')).toBeNull();
  });

  it('shows the accept-delivery button on a delivered booking and re-renders from the returned booking', async () => {
    mockedGet.mockReturnValue(ok(makeBooking('b1', { status: 'delivered' })));
    mockedPost.mockReturnValue(ok(makeBooking('b1', { status: 'released' })));
    open('/bookings/b1');

    fireEvent.press(await screen.findByTestId('booking-accept-delivery'));
    fireEvent.press(screen.getByTestId('booking-accept-delivery-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('booking-timeline-step-released').props).toMatchObject({
        accessibilityState: { selected: true },
      });
    });
    expect(screen.queryByTestId('booking-accept-delivery')).toBeNull();
  });

  it('offers no delivery actions to the client before delivery', async () => {
    mockedGet.mockReturnValue(ok(makeBooking('b1', { status: 'paid_held' })));
    open('/bookings/b1');

    await screen.findByTestId('booking-detail');
    expect(screen.queryByTestId('booking-accept-delivery')).toBeNull();
    expect(screen.queryByTestId('booking-delivery-form')).toBeNull();
  });

  it.each(['cancelled', 'refunded', 'disputed'])(
    'shows %s as a side exit with no current step',
    async (status) => {
      mockedGet.mockReturnValue(ok(makeBooking('b1', { status })));
      open('/bookings/b1');

      await screen.findByTestId('booking-timeline-exit');
      expect(screen.getByTestId('booking-timeline-step-paid_held').props).toMatchObject({
        accessibilityState: { selected: false },
      });
    },
  );

  it('explains a dispute and offers no actions', async () => {
    mockedGet.mockReturnValue(ok(makeBooking('b1', { status: 'disputed' })));
    open('/bookings/b1');

    await screen.findByTestId('booking-disputed');
    expect(screen.queryByTestId('booking-pay-panel')).toBeNull();
  });

  it('renders a booking where the user is the photographer as not found', async () => {
    mockedGet.mockReturnValue(
      ok(makeBooking('b1', { clientId: 'c-other', photographerId: 'p-self' })),
    );
    open('/bookings/b1');

    await screen.findByTestId('booking-detail-not-found');
    expect(screen.queryByTestId('booking-detail')).toBeNull();
  });

  it('shows not found for a 404, which is what the API answers to a non-party', async () => {
    mockedGet.mockReturnValue(failed(404));
    open('/bookings/b1');

    await screen.findByTestId('booking-detail-not-found');
  });

  it('shows a session message on 401', async () => {
    mockedGet.mockReturnValue(failed(401));
    open('/bookings/b1');

    await screen.findByTestId('booking-detail-unauthorized');
  });

  it('shows an error that retries', async () => {
    mockedGet.mockReturnValueOnce(failed(500));
    mockedGet.mockReturnValueOnce(ok(makeBooking('b1')));
    open('/bookings/b1');

    fireEvent.press(await screen.findByTestId('booking-detail-retry'));

    await screen.findByTestId('booking-detail');
  });

  it('shows an error when the request throws', async () => {
    mockedGet.mockRejectedValue(new Error('offline'));
    open('/bookings/b1');

    await screen.findByTestId('booking-detail-error');
  });
});
