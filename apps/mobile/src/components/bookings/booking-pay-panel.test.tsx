import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as stripe from '@stripe/stripe-react-native';

jest.mock('../../lib/env', () => ({ env: { EXPO_PUBLIC_API_URL: 'https://api.example.com' } }));

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `photoo://${path}`,
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { scheme: 'photoo' } },
}));

let mockVisible = true;
jest.mock('../../lib/use-screen-visible', () => ({ useScreenVisible: () => mockVisible }));

jest.mock('../../lib/api', () => ({
  api: { GET: jest.fn(), POST: jest.fn() },
  setUnauthorizedListener: jest.fn(),
}));

import '../../lib/i18n';
import { api } from '../../lib/api';
import { env } from '../../lib/env';
import { makeBooking } from '../../testing/booking-fixtures';
import { BookingPayPanel } from './booking-pay-panel';

const mockEnv: Record<string, string | undefined> = env;
const mockedGet = jest.mocked(api.GET);
const mockedPost = jest.mocked(api.POST);
const mockedRetrieve = jest.mocked(stripe.retrievePaymentIntent);
const mockedInit = jest.mocked(stripe.initPaymentSheet);
const mockedPresent = jest.mocked(stripe.presentPaymentSheet);
const providerProps = (stripe as unknown as { providerProps: Record<string, unknown>[] })
  .providerProps;

const CLIENT_SECRET = 'pi_3PabcDEF_secret_xyz789';

function ok(data: unknown) {
  return Promise.resolve({ data, error: undefined, response: new Response(null, { status: 200 }) });
}

function failed(status: number, error: object = {}) {
  return Promise.resolve({ data: undefined, error, response: new Response(null, { status }) });
}

function paymentIntentOk() {
  return ok({ clientSecret: CLIENT_SECRET, amount: { amountCents: 157777, currency: 'EUR' } });
}

function stripeIntent(status: string) {
  return Promise.resolve({ paymentIntent: { id: 'pi_3Pabc', status } });
}

function renderPanel() {
  const onBookingChanged = jest.fn();
  render(<BookingPayPanel bookingId="b1" onBookingChanged={onBookingChanged} />);
  return onBookingChanged;
}

async function flush() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function configured() {
  mockEnv.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_abc123';
  mockEnv.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER = 'merchant.lu.photoo.app';
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  providerProps.length = 0;
  mockVisible = true;
  delete mockEnv.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  delete mockEnv.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER;
  mockedPost.mockReturnValue(paymentIntentOk());
  mockedRetrieve.mockReturnValue(stripeIntent('RequiresPaymentMethod') as never);
  mockedInit.mockResolvedValue({});
  mockedPresent.mockResolvedValue({});
  mockedGet.mockReturnValue(ok(makeBooking('b1')));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('BookingPayPanel without a publishable key', () => {
  it('shows the unavailable state and never mounts Stripe or asks for a payment intent', async () => {
    renderPanel();
    await flush();

    expect(screen.getByTestId('booking-pay-unavailable')).toHaveTextContent(
      'Payment is not available in this environment',
    );
    expect(providerProps).toHaveLength(0);
    expect(mockedPost).not.toHaveBeenCalled();
    expect(mockedRetrieve).not.toHaveBeenCalled();
    expect(mockedInit).not.toHaveBeenCalled();
  });
});

describe('BookingPayPanel with a publishable key', () => {
  beforeEach(configured);

  it('wraps the flow in StripeProvider and initialises the sheet from the payment intent', async () => {
    renderPanel();
    await flush();

    expect(providerProps).toEqual([
      expect.objectContaining({
        publishableKey: 'pk_test_abc123',
        merchantIdentifier: 'merchant.lu.photoo.app',
        urlScheme: 'photoo',
      }),
    ]);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledWith('/v1/bookings/{id}/payment-intent', {
      params: { path: { id: 'b1' } },
    });
    expect(mockedRetrieve).toHaveBeenCalledWith(CLIENT_SECRET);
    expect(mockedInit).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentClientSecret: CLIENT_SECRET,
        merchantDisplayName: 'Photoo',
        returnURL: 'photoo://stripe-redirect',
        applePay: { merchantCountryCode: 'LU' },
        googlePay: { merchantCountryCode: 'LU', testEnv: true },
        allowsDelayedPaymentMethods: false,
      }),
    );
    expect(screen.getByTestId('booking-pay-button')).toHaveTextContent('Pay €1,577.77');
  });

  it('omits Apple Pay when no merchant identifier is set', async () => {
    delete mockEnv.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER;
    renderPanel();
    await flush();

    expect(providerProps[0]).not.toHaveProperty('merchantIdentifier');
    expect(mockedInit.mock.calls[0]?.[0]).not.toHaveProperty('applePay');
  });

  it('goes straight to processing when the payment intent already succeeded, without init', async () => {
    mockedRetrieve.mockReturnValue(stripeIntent('Succeeded') as never);
    renderPanel();
    await flush();

    expect(screen.getByTestId('booking-pay-processing')).toBeTruthy();
    expect(mockedInit).not.toHaveBeenCalled();
  });

  it.each(['Processing', 'RequiresCapture'])(
    'goes straight to processing for a %s payment intent',
    async (status) => {
      mockedRetrieve.mockReturnValue(stripeIntent(status) as never);
      renderPanel();
      await flush();

      expect(screen.getByTestId('booking-pay-processing')).toBeTruthy();
      expect(mockedInit).not.toHaveBeenCalled();
    },
  );

  it('keeps polling after the sheet closes and only hands over the booking once it is paid_held', async () => {
    const onBookingChanged = renderPanel();
    await flush();
    fireEvent.press(screen.getByTestId('booking-pay-button'));
    await flush();

    expect(screen.getByTestId('booking-pay-processing')).toBeTruthy();
    expect(onBookingChanged).not.toHaveBeenCalled();

    await advance(2000);
    await advance(4000);
    expect(mockedGet.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onBookingChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId('booking-pay-processing')).toBeTruthy();

    const paid = makeBooking('b1', { status: 'paid_held' });
    mockedGet.mockReturnValue(ok(paid));
    await advance(8000);

    expect(onBookingChanged).toHaveBeenCalledTimes(1);
    expect(onBookingChanged).toHaveBeenCalledWith(paid);
  });

  it('backs off 2, 4, 8, 16 and 32 seconds, then offers a refresh', async () => {
    mockedRetrieve.mockReturnValue(stripeIntent('Succeeded') as never);
    renderPanel();
    await flush();
    const initialReads = mockedGet.mock.calls.length;

    await advance(1999);
    expect(mockedGet).toHaveBeenCalledTimes(initialReads);
    await advance(1);
    expect(mockedGet).toHaveBeenCalledTimes(initialReads + 1);
    await advance(4000);
    await advance(8000);
    await advance(16000);
    expect(mockedGet).toHaveBeenCalledTimes(initialReads + 4);
    expect(screen.queryByTestId('booking-pay-timeout')).toBeNull();
    await advance(32000);

    expect(mockedGet).toHaveBeenCalledTimes(initialReads + 5);
    expect(screen.getByTestId('booking-pay-timeout')).toBeTruthy();

    fireEvent.press(screen.getByTestId('booking-pay-refresh'));
    await flush();
    expect(screen.getByTestId('booking-pay-processing')).toBeTruthy();
    expect(mockedGet).toHaveBeenCalledTimes(initialReads + 6);
  });

  it('re-reads the booking when the screen becomes visible again', async () => {
    mockedRetrieve.mockReturnValue(stripeIntent('Succeeded') as never);
    const onBookingChanged = jest.fn();
    const { rerender } = render(
      <BookingPayPanel bookingId="b1" onBookingChanged={onBookingChanged} />,
    );
    await flush();

    mockVisible = false;
    rerender(<BookingPayPanel bookingId="b1" onBookingChanged={onBookingChanged} />);
    await advance(60000);
    const readsWhileHidden = mockedGet.mock.calls.length;

    mockedGet.mockReturnValue(ok(makeBooking('b1', { status: 'paid_held' })));
    mockVisible = true;
    rerender(<BookingPayPanel bookingId="b1" onBookingChanged={onBookingChanged} />);
    await flush();

    expect(mockedGet.mock.calls.length).toBeGreaterThan(readsWhileHidden);
    expect(onBookingChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid_held' }));
  });

  it('returns to ready with no error when the sheet is cancelled', async () => {
    mockedPresent.mockResolvedValue({
      error: { code: 'Canceled', message: 'The payment flow has been canceled' },
    } as never);
    renderPanel();
    await flush();
    fireEvent.press(screen.getByTestId('booking-pay-button'));
    await flush();

    expect(screen.queryByTestId('booking-pay-failed')).toBeNull();
    expect(screen.queryByTestId('booking-pay-processing')).toBeNull();
    expect(screen.getByTestId('booking-pay-button')).toBeEnabled();
  });

  it("shows Stripe's localised message when the sheet fails", async () => {
    mockedPresent.mockResolvedValue({
      error: { code: 'Failed', message: 'declined', localizedMessage: 'Your card was declined.' },
    } as never);
    renderPanel();
    await flush();
    fireEvent.press(screen.getByTestId('booking-pay-button'));
    await flush();

    expect(screen.getByTestId('booking-pay-failed')).toHaveTextContent('Your card was declined.');
    expect(screen.getByTestId('booking-pay-button')).toBeEnabled();
  });

  it('falls back to the app message when Stripe gives none', async () => {
    mockedPresent.mockResolvedValue({ error: { code: 'Failed', message: 'declined' } } as never);
    renderPanel();
    await flush();
    fireEvent.press(screen.getByTestId('booking-pay-button'));
    await flush();

    expect(screen.getByTestId('booking-pay-failed')).toHaveTextContent(
      /The payment didn't go through/,
    );
  });

  it('presents the sheet once and asks for one payment intent however often it is tapped', async () => {
    let finish: (value: object) => void = () => undefined;
    mockedPresent.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    renderPanel();
    await flush();

    const button = screen.getByTestId('booking-pay-button');
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);
    await flush();

    expect(mockedPresent).toHaveBeenCalledTimes(1);
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('booking-pay-button')).toBeDisabled();

    finish({ error: { code: 'Canceled', message: 'canceled' } });
    await flush();
    expect(screen.getByTestId('booking-pay-button')).toBeEnabled();
  });

  it('re-reads the booking on a 409 and hands over the new status', async () => {
    mockedPost.mockReturnValue(failed(409, { code: 'CONFLICT' }));
    const moved = makeBooking('b1', { status: 'paid_held' });
    mockedGet.mockReturnValue(ok(moved));
    const onBookingChanged = renderPanel();
    await flush();

    expect(onBookingChanged).toHaveBeenCalledWith(moved);
    expect(mockedRetrieve).not.toHaveBeenCalled();
    expect(mockedInit).not.toHaveBeenCalled();
  });

  it('shows the conflict message when a 409 comes back but the booking is still unpaid', async () => {
    mockedPost.mockReturnValue(failed(409, { code: 'CONFLICT' }));
    const onBookingChanged = renderPanel();
    await flush();

    expect(onBookingChanged).not.toHaveBeenCalled();
    expect(screen.getByTestId('booking-pay-error')).toHaveTextContent(
      'This booking is no longer awaiting payment.',
    );
  });

  it('maps a rate limit and offers a retry that asks again', async () => {
    mockedPost.mockReturnValueOnce(
      failed(429, { code: 'TOO_MANY_REQUESTS', details: { retryAfterSeconds: 7 } }),
    );
    renderPanel();
    await flush();

    expect(screen.getByTestId('booking-pay-error')).toHaveTextContent(/too fast/);
    fireEvent.press(screen.getByTestId('booking-pay-retry'));
    await flush();

    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('booking-pay-button')).toBeTruthy();
  });

  it('shows a load error when the sheet cannot initialise, as with the fake gateway secret', async () => {
    mockedInit.mockResolvedValue({ error: { code: 'Failed', message: 'bad secret' } } as never);
    renderPanel();
    await flush();

    expect(screen.getByTestId('booking-pay-error')).toHaveTextContent(
      /We couldn't prepare the payment/,
    );
    expect(screen.queryByTestId('booking-pay-button')).toBeNull();
  });

  it('shows a load error when the payment intent cannot be retrieved', async () => {
    mockedRetrieve.mockResolvedValue({
      error: { code: 'Failed', message: 'network' },
    } as never);
    renderPanel();
    await flush();

    expect(screen.getByTestId('booking-pay-error')).toBeTruthy();
    expect(mockedInit).not.toHaveBeenCalled();
  });

  it('never renders the client secret', async () => {
    renderPanel();
    await flush();

    expect(JSON.stringify(screen.toJSON())).not.toContain(CLIENT_SECRET);
  });
});
