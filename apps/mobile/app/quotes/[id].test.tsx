import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { ReactNode } from 'react';

jest.mock('../../src/lib/auth-context', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ status: 'signed-in', user: { id: 'c1', roles: ['client'] } }),
}));

jest.mock('../../src/lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../src/lib/i18n';
import { makeBooking } from '../../src/testing/booking-fixtures';
import { renderedText } from '../../src/testing/rendered-text';
import { api } from '../../src/lib/api';

const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);

const QUOTE = {
  id: 'q1',
  requestId: 'r1',
  photographerId: 'p1',
  photographer: {
    id: 'p1',
    slug: 'jane-doe',
    displayName: 'Jane Doe Photography',
    avatarUrl: null,
    city: 'Luxembourg',
    countryCode: 'LU',
    ratingAvg: 4.5,
    ratingCount: 3,
  },
  clientId: 'c1',
  productId: null,
  productTierId: null,
  lineItems: [{ label: 'Full day coverage', qty: 2, unitCents: 75000 }],
  subtotal: { amountCents: 150000, currency: 'EUR' },
  platformFee: { amountCents: 1234, currency: 'EUR' },
  total: { amountCents: 157777, currency: 'EUR' },
  validUntil: '2999-12-01T00:00:00.000Z',
  message: 'Happy to help.',
  status: 'sent',
};

function ok(data: unknown) {
  return { data, error: undefined, response: new Response(null, { status: 200 }) };
}

function fail(status: number, error: object = {}) {
  return { data: undefined, error, response: new Response(null, { status }) };
}

function renderQuote(quote: object = QUOTE) {
  mockedGet.mockResolvedValue(ok(quote));
  return renderRouter('./app', { initialUrl: '/quotes/q1' });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('quote detail', () => {
  it('shows photographer, line items, total and validity from the real en catalog', async () => {
    renderQuote();

    await screen.findByTestId('quote-detail');
    expect(screen.getByText('Jane Doe Photography')).toBeTruthy();
    expect(screen.getByText('Full day coverage')).toBeTruthy();
    expect(screen.getByText('2 × €750.00')).toBeTruthy();
    expect(screen.getByTestId('quote-total').props.children).toBe('€1,577.77');
    expect(screen.getByText('Valid until')).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();
    expect(screen.getByText('Happy to help.')).toBeTruthy();
  });

  it('never renders the platform fee', async () => {
    renderQuote();

    await screen.findByTestId('quote-detail');
    const rendered = renderedText(screen.toJSON());
    expect(rendered).not.toContain('12.34');
    expect(rendered).not.toContain('1234');
    expect(screen.queryByText(/fee/i)).toBeNull();
  });

  it.each(['accepted', 'declined', 'expired', 'withdrawn', 'draft'])(
    'offers no accept or decline for a %s quote',
    async (status) => {
      renderQuote({ ...QUOTE, status });

      await screen.findByTestId('quote-detail');
      expect(screen.queryByTestId('quote-accept')).toBeNull();
      expect(screen.queryByTestId('quote-decline')).toBeNull();
    },
  );

  it('disables accept once the validity date has passed', async () => {
    renderQuote({ ...QUOTE, validUntil: '2000-01-01T00:00:00.000Z' });

    const accept = await screen.findByTestId('quote-accept');
    expect(accept.props as { accessibilityState: { disabled: boolean } }).toMatchObject({
      accessibilityState: { disabled: true },
    });
    fireEvent.press(accept);
    expect(screen.queryByTestId('quote-accept-panel')).toBeNull();
  });

  it('asks for confirmation before accepting and fires only on confirm', async () => {
    mockedPost.mockResolvedValue(ok({ ...QUOTE, status: 'accepted', bookingId: null }));
    renderQuote();

    fireEvent.press(await screen.findByTestId('quote-accept'));
    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByText('Accept this quote?')).toBeTruthy();

    fireEvent.press(screen.getByTestId('quote-accept-confirm'));
    await screen.findByTestId('quote-outcome');

    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith(
      '/v1/quotes/{id}/accept',
      expect.objectContaining({ params: { path: { id: 'q1' } } }),
    );
    expect(screen.getByText('Accepted')).toBeTruthy();
    expect(screen.queryByTestId('quote-accept')).toBeNull();
  });

  it('does not imply that money moved when a quote is accepted', async () => {
    mockedPost.mockResolvedValue(ok({ ...QUOTE, status: 'accepted', bookingId: null }));
    renderQuote();

    fireEvent.press(await screen.findByTestId('quote-accept'));
    fireEvent.press(screen.getByTestId('quote-accept-confirm'));

    await screen.findByTestId('quote-outcome');
    expect(screen.getByText(/Nothing has been charged/)).toBeTruthy();
    expect(renderedText(screen.toJSON())).not.toMatch(/paid|payment received|charged to/i);
  });

  it('opens the booking after accepting a quote that created one', async () => {
    mockedGet.mockImplementation(((path: string) =>
      Promise.resolve(
        ok(path === '/v1/bookings/{id}' ? makeBooking('b1', { quoteId: 'q1' }) : QUOTE),
      )) as never);
    mockedPost.mockResolvedValue(ok({ ...QUOTE, status: 'accepted', bookingId: 'b1' }));
    const view = renderRouter('./app', { initialUrl: '/quotes/q1' });

    fireEvent.press(await screen.findByTestId('quote-accept'));
    fireEvent.press(screen.getByTestId('quote-accept-confirm'));

    await screen.findByTestId('booking-detail');
    expect(view.getPathname()).toBe('/bookings/b1');
    expect(mockedGet).toHaveBeenCalledWith('/v1/bookings/{id}', {
      params: { path: { id: 'b1' } },
    });
  });

  it('links to the bookings list when the accepted quote has no booking id', async () => {
    mockedGet.mockImplementation(((path: string) =>
      Promise.resolve(
        ok(path === '/v1/bookings' ? { items: [], nextCursor: null } : QUOTE),
      )) as never);
    mockedPost.mockResolvedValue(ok({ ...QUOTE, status: 'accepted', bookingId: null }));
    const view = renderRouter('./app', { initialUrl: '/quotes/q1' });

    fireEvent.press(await screen.findByTestId('quote-accept'));
    fireEvent.press(screen.getByTestId('quote-accept-confirm'));
    fireEvent.press(await screen.findByTestId('quote-view-bookings'));

    await screen.findByTestId('bookings-empty');
    expect(view.getPathname()).toBe('/bookings');
  });

  it('stays on the quote after declining', async () => {
    mockedPost.mockResolvedValue(ok({ ...QUOTE, status: 'declined' }));
    const view = renderQuote();

    fireEvent.press(await screen.findByTestId('quote-decline'));
    fireEvent.press(screen.getByTestId('quote-decline-confirm'));

    await screen.findByTestId('quote-outcome');
    expect(view.getPathname()).toBe('/quotes/q1');
    expect(screen.queryByTestId('quote-view-bookings')).toBeNull();
  });

  it('dismissing the confirmation sends nothing', async () => {
    renderQuote();

    fireEvent.press(await screen.findByTestId('quote-accept'));
    fireEvent.press(screen.getByTestId('quote-accept-dismiss'));

    expect(mockedPost).not.toHaveBeenCalled();
    expect(screen.getByTestId('quote-accept')).toBeTruthy();
  });

  it('declines only after confirmation', async () => {
    mockedPost.mockResolvedValue(ok({ ...QUOTE, status: 'declined' }));
    renderQuote();

    fireEvent.press(await screen.findByTestId('quote-decline'));
    expect(mockedPost).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('quote-decline-confirm'));

    await screen.findByText('Quote declined.');
    expect(mockedPost).toHaveBeenCalledWith(
      '/v1/quotes/{id}/decline',
      expect.objectContaining({ params: { path: { id: 'q1' } } }),
    );
    expect(screen.getByText('Declined')).toBeTruthy();
  });

  it('leaves the quote unchanged and says so when the request fails', async () => {
    mockedPost.mockRejectedValue(new TypeError('Network request failed'));
    renderQuote();

    fireEvent.press(await screen.findByTestId('quote-accept'));
    fireEvent.press(screen.getByTestId('quote-accept-confirm'));

    await screen.findByTestId('quote-action-error');
    expect(screen.getByText(/the quote is unchanged/)).toBeTruthy();
    expect(screen.getByText('Sent')).toBeTruthy();
    expect(screen.getByTestId('quote-accept')).toBeTruthy();
    expect(screen.queryByTestId('quote-outcome')).toBeNull();
  });

  it('maps 409 to "no longer available" and leaves the quote unchanged', async () => {
    mockedPost.mockResolvedValue(fail(409, { code: 'CONFLICT' }));
    renderQuote();

    fireEvent.press(await screen.findByTestId('quote-accept'));
    fireEvent.press(screen.getByTestId('quote-accept-confirm'));

    await screen.findByText('This quote is no longer available.');
    expect(screen.getByText('Sent')).toBeTruthy();
  });

  it('maps a bare 422 and 429 status', async () => {
    mockedPost.mockResolvedValueOnce(fail(422));
    renderQuote();

    fireEvent.press(await screen.findByTestId('quote-accept'));
    fireEvent.press(screen.getByTestId('quote-accept-confirm'));
    await screen.findByText("This quote can't be changed right now.");

    mockedPost.mockResolvedValueOnce(fail(429));
    fireEvent.press(screen.getByTestId('quote-accept'));
    fireEvent.press(screen.getByTestId('quote-accept-confirm'));
    await screen.findByText("You're doing that too fast. Slow down and try again.");
  });

  it('sends a single accept when confirm is pressed twice', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockedPost.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as ReturnType<typeof api.POST>,
    );
    renderQuote();

    fireEvent.press(await screen.findByTestId('quote-accept'));
    fireEvent.press(screen.getByTestId('quote-accept-confirm'));
    fireEvent.press(screen.getByTestId('quote-accept-confirm'));
    expect(mockedPost).toHaveBeenCalledTimes(1);

    finish(ok({ ...QUOTE, status: 'accepted', bookingId: null }));
    await waitFor(() => screen.getByTestId('quote-outcome'));
  });

  it('says the quote was not found for a 404', async () => {
    mockedGet.mockResolvedValue(fail(404));
    renderRouter('./app', { initialUrl: '/quotes/q1' });

    await screen.findByText("This quote doesn't exist, or it isn't yours.");
  });

  it('retries a failed load', async () => {
    mockedGet.mockResolvedValueOnce(fail(500)).mockResolvedValueOnce(ok(QUOTE));
    renderRouter('./app', { initialUrl: '/quotes/q1' });

    fireEvent.press(await screen.findByTestId('quote-detail-retry'));

    await screen.findByTestId('quote-detail');
  });
});
