import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { translate } from '@/testing/mock-translations';

const getStripeMock = vi.fn();
const apiPostMock = vi.fn();
const confirmPaymentMock = vi.fn();
const stripeClientMock = { confirmPayment: confirmPaymentMock };
const elementsClientMock = {};

vi.mock('@/lib/stripe', () => ({ getStripe: getStripeMock }));
vi.mock('@/lib/api', () => ({ api: { POST: apiPostMock } }));
vi.mock('next-intl', async () => {
  const { mockUseTranslations } = await import('@/testing/mock-translations');
  return { useTranslations: mockUseTranslations };
});
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe: () => stripeClientMock,
  useElements: () => elementsClientMock,
}));

const RETURN_URL = 'https://photoo.lu/en/bookings/return';
const BOOKING_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

async function loadBookingCheckout() {
  const { BookingCheckout } = await import('./booking-checkout');
  return BookingCheckout;
}

describe('BookingCheckout', () => {
  afterEach(() => {
    getStripeMock.mockReset();
    apiPostMock.mockReset();
    confirmPaymentMock.mockReset();
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
});
