import { PaymentSheetError, StripeProvider, useStripe } from '@stripe/stripe-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { resolveLocale } from '@photoo/shared';

import { api } from '../../lib/api';
import type { Booking } from '../../lib/booking-status';
import { env } from '../../lib/env';
import { formatMoney, requireMoney, type Money } from '../../lib/money';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedBookingTranslate,
} from '../../lib/request-errors';
import {
  PAYMENT_POLL_DELAYS_MS,
  appUrlScheme,
  isPaymentIntentInFlight,
  paymentSheetParams,
} from '../../lib/stripe';
import { useScreenVisible } from '../../lib/use-screen-visible';
import { FormNotice } from '../form/form-notice';
import { PrimaryButton } from '../form/primary-button';

type PayState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; amount: Money }
  | { status: 'processing' }
  | { status: 'processingTimedOut' };

async function readBooking(bookingId: string): Promise<Booking | null> {
  try {
    const { data } = await api.GET('/v1/bookings/{id}', { params: { path: { id: bookingId } } });
    return data ?? null;
  } catch {
    return null;
  }
}

function PayPanelFrame({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <View className="gap-3 rounded-lg border border-border p-4" testID="booking-pay-panel">
      <Text className="text-lg font-semibold text-foreground">
        {t('mobile.bookings.pay.title')}
      </Text>
      <Text className="text-sm text-muted-foreground">{t('mobile.bookings.pay.description')}</Text>
      {children}
    </View>
  );
}

function PayFlow({
  bookingId,
  onBookingChanged,
}: {
  bookingId: string;
  onBookingChanged: (booking: Booking) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const { retrievePaymentIntent, initPaymentSheet, presentPaymentSheet } = useStripe();
  const visible = useScreenVisible();
  const [state, setState] = useState<PayState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [payError, setPayError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const pollIndex = useRef(0);
  const onChangedRef = useRef(onBookingChanged);
  onChangedRef.current = onBookingChanged;

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    async function prepare() {
      setState({ status: 'loading' });
      try {
        const { data, error, response } = await api.POST('/v1/bookings/{id}/payment-intent', {
          params: { path: { id: bookingId } },
        });
        if (isCancelled()) {
          return;
        }
        if (!data) {
          if (response.status === 409) {
            const booking = await readBooking(bookingId);
            if (isCancelled()) {
              return;
            }
            if (booking && booking.status !== 'pending_payment') {
              onChangedRef.current(booking);
              return;
            }
          }
          setState({
            status: 'error',
            message: requestErrorMessage(
              scopedBookingTranslate(t),
              apiErrorWithStatus(error, response.status),
            ),
          });
          return;
        }

        const retrieved = await retrievePaymentIntent(data.clientSecret);
        if (isCancelled()) {
          return;
        }
        if (retrieved.error) {
          setState({ status: 'error', message: t('mobile.bookings.pay.loadFailed') });
          return;
        }
        if (isPaymentIntentInFlight(retrieved.paymentIntent.status)) {
          pollIndex.current = 0;
          setState({ status: 'processing' });
          return;
        }

        const init = await initPaymentSheet(
          paymentSheetParams(data.clientSecret, env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER),
        );
        if (isCancelled()) {
          return;
        }
        if (init.error) {
          setState({ status: 'error', message: t('mobile.bookings.pay.loadFailed') });
          return;
        }
        setState({ status: 'ready', amount: requireMoney(data.amount, 'payment amount') });
      } catch {
        if (!isCancelled()) {
          setState({ status: 'error', message: t('mobile.bookings.pay.loadFailed') });
        }
      }
    }

    void prepare();
    return () => {
      cancelled = true;
    };
  }, [bookingId, attempt, t, retrievePaymentIntent, initPaymentSheet]);

  const polling = state.status === 'processing';

  useEffect(() => {
    if (!polling || !visible) {
      return;
    }
    let cancelled = false;
    const isCancelled = () => cancelled;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    async function read(): Promise<boolean> {
      const booking = await readBooking(bookingId);
      if (isCancelled()) {
        return true;
      }
      if (booking && booking.status !== 'pending_payment') {
        onChangedRef.current(booking);
        return true;
      }
      return false;
    }

    function schedule() {
      const delay = PAYMENT_POLL_DELAYS_MS[pollIndex.current];
      if (delay === undefined) {
        setState({ status: 'processingTimedOut' });
        return;
      }
      timeoutId = setTimeout(() => {
        pollIndex.current += 1;
        void read().then((done) => {
          if (!done) {
            schedule();
          }
        });
      }, delay);
    }

    void read().then((done) => {
      if (!done) {
        schedule();
      }
    });

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [polling, visible, bookingId]);

  async function pay() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setPayError(null);
    try {
      const { error } = await presentPaymentSheet();
      if (!error) {
        pollIndex.current = 0;
        setState({ status: 'processing' });
      } else if (error.code !== PaymentSheetError.Canceled) {
        setPayError(error.localizedMessage ?? t('mobile.bookings.pay.failed'));
      }
    } catch {
      setPayError(t('mobile.bookings.pay.failed'));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function restartPolling() {
    pollIndex.current = 0;
    setState({ status: 'processing' });
  }

  return (
    <PayPanelFrame>
      {state.status === 'loading' ? (
        <FormNotice tone="info" testID="booking-pay-loading">
          {t('mobile.bookings.pay.loading')}
        </FormNotice>
      ) : null}
      {state.status === 'error' ? (
        <>
          <FormNotice tone="error" testID="booking-pay-error">
            {state.message}
          </FormNotice>
          <PrimaryButton
            label={t('mobile.bookings.pay.retry')}
            onPress={() => {
              setAttempt((current) => current + 1);
            }}
            testID="booking-pay-retry"
          />
        </>
      ) : null}
      {state.status === 'ready' ? (
        <>
          {payError ? (
            <FormNotice tone="error" testID="booking-pay-failed">
              {payError}
            </FormNotice>
          ) : null}
          <PrimaryButton
            label={t('mobile.bookings.pay.payCta', { amount: formatMoney(state.amount, locale) })}
            onPress={() => void pay()}
            disabled={submitting}
            loading={submitting}
            testID="booking-pay-button"
          />
        </>
      ) : null}
      {state.status === 'processing' ? (
        <FormNotice tone="info" testID="booking-pay-processing">
          {t('mobile.bookings.pay.processing')}
        </FormNotice>
      ) : null}
      {state.status === 'processingTimedOut' ? (
        <>
          <FormNotice tone="info" testID="booking-pay-timeout">
            {t('mobile.bookings.pay.processingTimeout')}
          </FormNotice>
          <PrimaryButton
            label={t('mobile.bookings.pay.refresh')}
            onPress={restartPolling}
            testID="booking-pay-refresh"
          />
        </>
      ) : null}
    </PayPanelFrame>
  );
}

export function BookingPayPanel({
  bookingId,
  onBookingChanged,
}: {
  bookingId: string;
  onBookingChanged: (booking: Booking) => void;
}) {
  const { t } = useTranslation();
  const publishableKey = env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const merchantIdentifier = env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER;
  const urlScheme = appUrlScheme();

  if (!publishableKey) {
    return (
      <PayPanelFrame>
        <FormNotice tone="info" testID="booking-pay-unavailable">
          {t('mobile.bookings.pay.unavailable')}
        </FormNotice>
      </PayPanelFrame>
    );
  }

  return (
    <StripeProvider
      publishableKey={publishableKey}
      {...(merchantIdentifier ? { merchantIdentifier } : {})}
      {...(urlScheme ? { urlScheme } : {})}
    >
      <PayFlow bookingId={bookingId} onBookingChanged={onBookingChanged} />
    </StripeProvider>
  );
}
