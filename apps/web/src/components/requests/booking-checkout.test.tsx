import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const getStripeMock = vi.fn();
const apiPostMock = vi.fn();
const confirmPaymentMock = vi.fn();
const retrievePaymentIntentMock = vi.fn();
const stripeClientMock = {
  confirmPayment: confirmPaymentMock,
  retrievePaymentIntent: retrievePaymentIntentMock,
};
const elementsClientMock = {};
const routerReplaceMock = vi.fn();
const routerRefreshMock = vi.fn();
const routerMock = { replace: routerReplaceMock, refresh: routerRefreshMock };
let searchParamsMock = new URLSearchParams();

vi.mock('@/lib/stripe', () => ({ getStripe: getStripeMock }));
vi.mock('@/lib/api', () => ({ api: { POST: apiPostMock } }));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  const cache = new Map<string, ReturnType<typeof mockUseTranslations>>();
  return {
    useTranslations: (namespace: string) => {
      const cached = cache.get(namespace);
      if (cached) {
        return cached;
      }
      const translator = mockUseTranslations(namespace);
      cache.set(namespace, translator);
      return translator;
    },
  };
});
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => stripeClientMock,
  useElements: () => elementsClientMock,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => PATHNAME,
  useSearchParams: () => searchParamsMock,
}));

const RETURN_URL = 'https://photoo.lu/en/bookings/return';
const BOOKING_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const PATHNAME = `/en/bookings/${BOOKING_ID}`;

async function loadBookingCheckout() {
  const { BookingCheckout } = await import('./booking-checkout');
  return BookingCheckout;
}

describe('BookingCheckout', () => {
  afterEach(() => {
    vi.useRealTimers();
    getStripeMock.mockReset();
    apiPostMock.mockReset();
    confirmPaymentMock.mockReset();
    retrievePaymentIntentMock.mockReset();
    routerReplaceMock.mockReset();
    routerRefreshMock.mockReset();
    searchParamsMock = new URLSearchParams();
  });

  it('shows the unavailable notice when Stripe has no publishable key configured', async () => {
    getStripeMock.mockResolvedValue(null);
    const BookingCheckout = await loadBookingCheckout();

    render(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    expect(
      await screen.findByText(translate('web.bookings.detail', 'checkout.unavailable')),
    ).toBeInTheDocument();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('shows a mapped error when the payment intent request fails', async () => {
    getStripeMock.mockResolvedValue(stripeClientMock);
    apiPostMock.mockResolvedValue({ data: undefined, error: { code: 'CONFLICT' } });
    const BookingCheckout = await loadBookingCheckout();

    render(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    expect(
      await screen.findByText(translate('web.bookings', 'errors.conflict')),
    ).toBeInTheDocument();
  });

  it('shows a mapped error when the payment intent request is rejected as invalid', async () => {
    getStripeMock.mockResolvedValue(stripeClientMock);
    apiPostMock.mockResolvedValue({ data: undefined, error: { code: 'UNPROCESSABLE_ENTITY' } });
    const BookingCheckout = await loadBookingCheckout();

    render(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    expect(
      await screen.findByText(translate('web.bookings', 'errors.invalid')),
    ).toBeInTheDocument();
  });

  it('shows a mapped error when the payment intent request is rate-limited', async () => {
    getStripeMock.mockResolvedValue(stripeClientMock);
    apiPostMock.mockResolvedValue({ data: undefined, error: { code: 'TOO_MANY_REQUESTS' } });
    const BookingCheckout = await loadBookingCheckout();

    render(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    expect(
      await screen.findByText(translate('web.bookings', 'errors.tooManyRequests')),
    ).toBeInTheDocument();
  });

  it('shows a mapped error with a retry delay when the payment intent request is rate-limited with a retry-after', async () => {
    getStripeMock.mockResolvedValue(stripeClientMock);
    apiPostMock.mockResolvedValue({
      data: undefined,
      error: { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 30 } },
    });
    const BookingCheckout = await loadBookingCheckout();

    render(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    expect(
      await screen.findByText(
        translate('web.bookings', 'errors.tooManyRequestsWithRetry', { seconds: 30 }),
      ),
    ).toBeInTheDocument();
  });

  it('shows a load-error message when the payment intent request throws', async () => {
    getStripeMock.mockResolvedValue(stripeClientMock);
    apiPostMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const BookingCheckout = await loadBookingCheckout();

    render(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    expect(
      await screen.findByText(translate('web.bookings.detail', 'checkout.loadError')),
    ).toBeInTheDocument();
  });

  it('renders the payment form once the payment intent is ready and submits it on confirm', async () => {
    getStripeMock.mockResolvedValue(stripeClientMock);
    apiPostMock.mockResolvedValue({
      data: { clientSecret: 'pi_123_secret_abc' },
      error: undefined,
    });
    confirmPaymentMock.mockResolvedValue({ error: { message: 'Your card was declined.' } });
    const BookingCheckout = await loadBookingCheckout();
    const user = userEvent.setup();

    render(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    expect(apiPostMock).toHaveBeenCalledWith('/v1/bookings/{id}/payment-intent', {
      params: { path: { id: BOOKING_ID } },
    });

    await user.click(
      screen.getByRole('button', { name: translate('web.bookings.detail', 'checkout.payCta') }),
    );

    expect(confirmPaymentMock).toHaveBeenCalledWith({
      elements: elementsClientMock,
      confirmParams: { return_url: RETURN_URL },
    });
    expect(await screen.findByText('Your card was declined.')).toBeInTheDocument();
  });

  it('strips the Stripe return params from the URL after returning from a redirect', async () => {
    searchParamsMock = new URLSearchParams(
      'foo=bar&payment_intent_client_secret=pi_123_secret_abc&payment_intent=pi_123&redirect_status=succeeded',
    );
    getStripeMock.mockResolvedValue(stripeClientMock);
    retrievePaymentIntentMock.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    const BookingCheckout = await loadBookingCheckout();

    render(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    expect(
      await screen.findByText(translate('web.bookings.detail', 'checkout.processingReturn')),
    ).toBeInTheDocument();
    expect(routerReplaceMock).toHaveBeenCalledWith(`${PATHNAME}?foo=bar`, { scroll: false });
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('shows a processing notice and polls with capped backoff until the timeout notice appears', async () => {
    vi.useFakeTimers();
    searchParamsMock = new URLSearchParams(
      'payment_intent_client_secret=pi_123_secret_abc&payment_intent=pi_123&redirect_status=succeeded',
    );
    getStripeMock.mockResolvedValue(stripeClientMock);
    retrievePaymentIntentMock.mockResolvedValue({ paymentIntent: { status: 'processing' } });
    const BookingCheckout = await loadBookingCheckout();

    render(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByText(translate('web.bookings.detail', 'checkout.processingReturn')),
    ).toBeInTheDocument();
    expect(apiPostMock).not.toHaveBeenCalled();
    expect(retrievePaymentIntentMock).toHaveBeenCalledWith('pi_123_secret_abc');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16000);
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32000);
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(5);

    expect(
      screen.getByText(translate('web.bookings.detail', 'checkout.processingTimeout')),
    ).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(routerRefreshMock).toHaveBeenCalledTimes(5);
  });

  it('keeps the processing notice and does not request a new payment intent after the return params are stripped from the URL', async () => {
    searchParamsMock = new URLSearchParams(
      'payment_intent_client_secret=pi_123_secret_abc&payment_intent=pi_123&redirect_status=succeeded',
    );
    getStripeMock.mockResolvedValue(stripeClientMock);
    retrievePaymentIntentMock.mockResolvedValue({ paymentIntent: { status: 'processing' } });
    routerReplaceMock.mockImplementation(() => {
      searchParamsMock = new URLSearchParams();
    });
    const BookingCheckout = await loadBookingCheckout();

    const { rerender } = render(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    expect(
      await screen.findByText(translate('web.bookings.detail', 'checkout.processingReturn')),
    ).toBeInTheDocument();
    expect(retrievePaymentIntentMock).toHaveBeenCalledTimes(1);

    rerender(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    expect(
      screen.getByText(translate('web.bookings.detail', 'checkout.processingReturn')),
    ).toBeInTheDocument();
    expect(retrievePaymentIntentMock).toHaveBeenCalledTimes(1);
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('shows an error and still loads a fresh payment intent when the return status is requires_payment_method', async () => {
    searchParamsMock = new URLSearchParams(
      'payment_intent_client_secret=pi_123_secret_abc&payment_intent=pi_123&redirect_status=failed',
    );
    getStripeMock.mockResolvedValue(stripeClientMock);
    retrievePaymentIntentMock.mockResolvedValue({
      paymentIntent: { status: 'requires_payment_method' },
    });
    apiPostMock.mockResolvedValue({
      data: { clientSecret: 'pi_456_secret_def' },
      error: undefined,
    });
    const BookingCheckout = await loadBookingCheckout();

    render(<BookingCheckout bookingId={BOOKING_ID} returnUrl={RETURN_URL} />);

    expect(
      await screen.findByText(translate('web.bookings.detail', 'checkout.paymentFailed')),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('payment-element')).toBeInTheDocument();
    expect(apiPostMock).toHaveBeenCalledWith('/v1/bookings/{id}/payment-intent', {
      params: { path: { id: BOOKING_ID } },
    });
  });
});
