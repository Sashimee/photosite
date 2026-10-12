'use client';

import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import type { Stripe, StripeElements } from '@stripe/stripe-js';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';
import { getStripe } from '@/lib/stripe';

const IN_FLIGHT_PAYMENT_INTENT_STATUSES = new Set(['processing', 'succeeded', 'requires_capture']);
const POLL_DELAYS_MS = [2000, 4000, 8000, 16000, 32000];

type CheckoutState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error'; message: string }
  | { status: 'ready'; clientSecret: string }
  | { status: 'processing' }
  | { status: 'processingTimedOut' };

function PayForm({ returnUrl }: { returnUrl: string }) {
  const t = useTranslations('web.bookings.detail');
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(stripeClient: Stripe, elementsClient: StripeElements) {
    setSubmitting(true);
    setError(null);
    const { error: confirmError } = await stripeClient.confirmPayment({
      elements: elementsClient,
      confirmParams: { return_url: returnUrl },
    });
    setError(confirmError.message ?? t('checkout.loadError'));
    setSubmitting(false);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!stripe || !elements) {
          return;
        }
        void handleSubmit(stripe, elements);
      }}
      className="flex flex-col gap-4"
    >
      <PaymentElement />
      {error ? <FormNotice tone="error">{error}</FormNotice> : null}
      <Button type="submit" disabled={!stripe || !elements || submitting} aria-busy={submitting}>
        {submitting ? t('checkout.processing') : t('checkout.payCta')}
      </Button>
    </form>
  );
}

export function BookingCheckout({
  bookingId,
  returnUrl,
}: {
  bookingId: string;
  returnUrl: string;
}) {
  const t = useTranslations('web.bookings.detail');
  const tErrors = useTranslations('web.bookings');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<CheckoutState>({ status: 'loading' });
  const [returnError, setReturnError] = useState<string | null>(null);

  const [returnClientSecret] = useState(() => searchParams.get('payment_intent_client_secret'));

  useEffect(() => {
    if (!returnClientSecret) {
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.delete('payment_intent_client_secret');
    params.delete('payment_intent');
    params.delete('redirect_status');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [returnClientSecret]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    function poll(attempt: number) {
      if (attempt >= POLL_DELAYS_MS.length) {
        setState({ status: 'processingTimedOut' });
        return;
      }
      timeoutId = setTimeout(() => {
        if (cancelled) {
          return;
        }
        router.refresh();
        poll(attempt + 1);
      }, POLL_DELAYS_MS[attempt]);
    }

    async function loadPaymentIntent() {
      const stripe = await getStripe();
      if (!stripe) {
        if (!cancelled) {
          setState({ status: 'unavailable' });
        }
        return;
      }
      try {
        const { data, error } = await api.POST('/v1/bookings/{id}/payment-intent', {
          params: { path: { id: bookingId } },
        });
        if (cancelled) {
          return;
        }
        if (!data) {
          setState({ status: 'error', message: requestErrorMessage(tErrors, error) });
          return;
        }
        setState({ status: 'ready', clientSecret: data.clientSecret });
      } catch {
        if (!cancelled) {
          setState({ status: 'error', message: t('checkout.loadError') });
        }
      }
    }

    async function start() {
      if (!returnClientSecret) {
        await loadPaymentIntent();
        return;
      }
      const stripe = await getStripe();
      if (!stripe) {
        if (!cancelled) {
          setState({ status: 'unavailable' });
        }
        return;
      }
      const { paymentIntent } = await stripe.retrievePaymentIntent(returnClientSecret);
      if (cancelled) {
        return;
      }
      if (paymentIntent && IN_FLIGHT_PAYMENT_INTENT_STATUSES.has(paymentIntent.status)) {
        setState({ status: 'processing' });
        poll(0);
        return;
      }
      if (paymentIntent?.status === 'requires_payment_method') {
        setReturnError(t('checkout.paymentFailed'));
      }
      await loadPaymentIntent();
    }

    void start();
    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [bookingId, returnClientSecret, router, t, tErrors]);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">{t('checkout.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('checkout.description')}</p>
      </div>

      {returnError ? <FormNotice tone="error">{returnError}</FormNotice> : null}

      {state.status === 'loading' ? (
        <FormNotice tone="info">{t('checkout.processing')}</FormNotice>
      ) : null}
      {state.status === 'unavailable' ? (
        <FormNotice tone="info">{t('checkout.unavailable')}</FormNotice>
      ) : null}
      {state.status === 'error' ? <FormNotice tone="error">{state.message}</FormNotice> : null}
      {state.status === 'processing' ? (
        <FormNotice tone="info">{t('checkout.processingReturn')}</FormNotice>
      ) : null}
      {state.status === 'processingTimedOut' ? (
        <FormNotice tone="info">{t('checkout.processingTimeout')}</FormNotice>
      ) : null}
      {state.status === 'ready' ? (
        <Elements stripe={getStripe()} options={{ clientSecret: state.clientSecret }}>
          <PayForm returnUrl={returnUrl} />
        </Elements>
      ) : null}
    </div>
  );
}
