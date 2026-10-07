import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { id: 'u-photographer', roles: ['photographer'] } }),
}));

jest.mock('../../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../../src/lib/i18n';
import { api } from '../../../src/lib/api';
import { makeBooking } from '../../../src/testing/booking-fixtures';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);

function ok(data: unknown) {
  return Promise.resolve({ data, error: undefined, response: new Response(null, { status: 200 }) });
}

function failed(status: number) {
  return Promise.resolve({ data: undefined, error: {}, response: new Response(null, { status }) });
}

interface World {
  profile?: Promise<unknown>;
  bookings?: () => Promise<unknown>;
  booking?: () => Promise<unknown>;
}

function mockWorld(world: World) {
  mockedGet.mockImplementation(((path: string) => {
    if (path === '/v1/me/photographer-profile') {
      return world.profile ?? ok({ id: 'p1', isPublished: true });
    }
    if (path === '/v1/bookings') {
      return world.bookings ? world.bookings() : ok({ items: [], nextCursor: null });
    }
    if (path === '/v1/bookings/{id}') {
      return world.booking ? world.booking() : failed(404);
    }
    return failed(500);
  }) as never);
}

function open(url: string) {
  return renderRouter('./app', { initialUrl: url });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('studio bookings list', () => {
  it('shows only bookings of the own photographer profile', async () => {
    mockWorld({
      bookings: () =>
        ok({
          items: [
            makeBooking('b1', { status: 'paid_held' }),
            makeBooking('b2', { photographerId: 'p-other', clientId: 'u-photographer' }),
          ],
          nextCursor: null,
        }),
    });
    open('/studio/bookings');

    await screen.findByTestId('booking-card-b1');
    expect(screen.queryByTestId('booking-card-b2')).toBeNull();
    expect(screen.getByText('Paid, held until delivery')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    mockWorld({});
    open('/studio/bookings');

    await screen.findByTestId('bookings-empty');
  });

  it('shows the empty state without listing anything when there is no photographer profile', async () => {
    mockWorld({ profile: failed(404) });
    open('/studio/bookings');

    await screen.findByTestId('bookings-empty');
    expect(mockedGet).not.toHaveBeenCalledWith('/v1/bookings', expect.anything());
  });

  it('shows a session message when the profile read is 401', async () => {
    mockWorld({ profile: failed(401) });
    open('/studio/bookings');

    await screen.findByTestId('bookings-unauthorized');
  });

  it('shows a session message when the bookings read is 401', async () => {
    mockWorld({ bookings: () => failed(401) });
    open('/studio/bookings');

    await screen.findByTestId('bookings-unauthorized');
  });

  it('shows an error that retries when the profile read fails', async () => {
    mockedGet.mockReturnValueOnce(failed(500));
    mockWorld({ bookings: () => ok({ items: [makeBooking('b1')], nextCursor: null }) });
    open('/studio/bookings');

    fireEvent.press(await screen.findByTestId('bookings-profile-retry'));

    await screen.findByTestId('booking-card-b1');
  });

  it('shows an error that retries when the bookings read fails', async () => {
    let calls = 0;
    mockWorld({
      bookings: () =>
        calls++ === 0 ? failed(500) : ok({ items: [makeBooking('b1')], nextCursor: null }),
    });
    open('/studio/bookings');

    fireEvent.press(await screen.findByTestId('bookings-retry'));

    await screen.findByTestId('booking-card-b1');
  });

  it('is reachable from the Studio hub and opens the booking', async () => {
    mockWorld({
      bookings: () => ok({ items: [makeBooking('b1')], nextCursor: null }),
      booking: () => ok(makeBooking('b1')),
    });
    const view = open('/studio');

    fireEvent.press(await screen.findByTestId('studio-entry-bookings'));
    fireEvent.press(await screen.findByTestId('booking-card-b1'));

    await screen.findByTestId('booking-detail');
    expect(view.getPathname()).toBe('/studio/bookings/b1');
  });
});

describe('studio booking detail', () => {
  it('shows the booking with the photographer wording on release', async () => {
    mockWorld({
      booking: () =>
        ok(
          makeBooking('b1', {
            status: 'delivered',
            releaseDueAt: '2027-01-09T10:00:00.000Z',
          }),
        ),
    });
    open('/studio/bookings/b1');

    await screen.findByTestId('booking-detail');
    expect(screen.getByTestId('booking-release-due')).toHaveTextContent(
      /releases to you automatically/,
    );
    expect(screen.queryByTestId('booking-pay-panel')).toBeNull();
  });

  it('delivers a paid booking and reloads it', async () => {
    let status = 'paid_held';
    mockWorld({ booking: () => ok(makeBooking('b1', { status })) });
    mockedPost.mockImplementation((() => {
      status = 'delivered';
      return ok({ delivery: { id: 'd1' } });
    }) as never);
    open('/studio/bookings/b1');

    fireEvent.changeText(await screen.findByTestId('booking-delivery-message'), 'Done');
    fireEvent.changeText(
      screen.getByTestId('booking-delivery-link'),
      'https://files.example.com/x',
    );
    fireEvent.press(screen.getByTestId('booking-delivery-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('booking-delivery-form')).toBeNull();
    });
    expect(screen.getByTestId('booking-timeline-step-delivered').props).toMatchObject({
      accessibilityState: { selected: true },
    });
    expect(mockedPost).toHaveBeenCalledWith(
      '/v1/bookings/{id}/delivery',
      expect.objectContaining({ params: { path: { id: 'b1' } } }),
    );
  });

  it('offers no accept-delivery button to the photographer', async () => {
    mockWorld({ booking: () => ok(makeBooking('b1', { status: 'delivered' })) });
    open('/studio/bookings/b1');

    await screen.findByTestId('booking-detail');
    expect(screen.queryByTestId('booking-accept-delivery')).toBeNull();
    expect(screen.queryByTestId('booking-delivery-form')).toBeNull();
  });

  it('explains a dispute to the photographer', async () => {
    mockWorld({ booking: () => ok(makeBooking('b1', { status: 'disputed' })) });
    open('/studio/bookings/b1');

    await screen.findByTestId('booking-disputed');
    expect(screen.getByTestId('booking-disputed')).toHaveTextContent(/on hold/);
  });

  it('renders a booking of another photographer as not found', async () => {
    mockWorld({ booking: () => ok(makeBooking('b1', { photographerId: 'p-other' })) });
    open('/studio/bookings/b1');

    await screen.findByTestId('booking-detail-not-found');
    expect(screen.queryByTestId('booking-detail')).toBeNull();
  });

  it('shows not found for a 404', async () => {
    mockWorld({ booking: () => failed(404) });
    open('/studio/bookings/b1');

    await screen.findByTestId('booking-detail-not-found');
  });

  it('shows not found without a photographer profile', async () => {
    mockWorld({ profile: failed(404), booking: () => ok(makeBooking('b1')) });
    open('/studio/bookings/b1');

    await screen.findByTestId('booking-detail-not-found');
  });

  it('shows a session message on 401', async () => {
    mockWorld({ booking: () => failed(401) });
    open('/studio/bookings/b1');

    await screen.findByTestId('booking-detail-unauthorized');
  });

  it('retries only the failed read', async () => {
    let calls = 0;
    mockWorld({ booking: () => (calls++ === 0 ? failed(500) : ok(makeBooking('b1'))) });
    open('/studio/bookings/b1');

    fireEvent.press(await screen.findByTestId('booking-detail-retry'));

    await screen.findByTestId('booking-detail');
    expect(mockedGet).toHaveBeenCalledTimes(3);
  });

  it('retries a failed profile read', async () => {
    let calls = 0;
    mockWorld({});
    const base = mockedGet.getMockImplementation();
    mockedGet.mockImplementation(((path: string, init: unknown) => {
      if (path === '/v1/me/photographer-profile' && calls++ === 0) {
        return failed(500);
      }
      if (path === '/v1/bookings/{id}') {
        return ok(makeBooking('b1'));
      }
      return (base as (p: string, i: unknown) => unknown)(path, init);
    }) as never);
    open('/studio/bookings/b1');

    fireEvent.press(await screen.findByTestId('booking-detail-retry'));

    await screen.findByTestId('booking-detail');
  });
});
