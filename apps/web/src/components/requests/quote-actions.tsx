'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

import { ConfirmActionButton } from './confirm-action-button';

type Quote = components['schemas']['Quote'];

export function QuoteActions({
  quote,
  currentUserId,
  locale,
}: {
  quote: Quote;
  currentUserId: string;
  locale: Locale;
}) {
  const t = useTranslations('web.quotes.detail');
  const tErrors = useTranslations('web.quotes');
  const router = useRouter();
  const isSent = quote.status === 'sent';
  const isExpired = new Date(quote.validUntil).getTime() < Date.now();

  const [acceptPending, setAcceptPending] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  // Only ever set from the accept response itself: `GET /quotes/{id}` never
  // returns a bookingId, so this doesn't survive a hard reload once accepted.
  const [acceptedBookingId, setAcceptedBookingId] = useState<string | null>(null);
  const [declinePending, setDeclinePending] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);

  if (quote.clientId !== currentUserId) {
    return null;
  }

  async function accept(): Promise<boolean> {
    setAcceptPending(true);
    setAcceptError(null);
    try {
      const { data, error } = await api.POST('/v1/quotes/{id}/accept', {
        params: { path: { id: quote.id } },
      });
      if (error) {
        setAcceptError(requestErrorMessage(tErrors, error));
        return false;
      }
      setAcceptedBookingId(data.bookingId);
      router.refresh();
      return true;
    } catch {
      setAcceptError(requestErrorMessage(tErrors, undefined));
      return false;
    } finally {
      setAcceptPending(false);
    }
  }

  async function decline(): Promise<boolean> {
    setDeclinePending(true);
    setDeclineError(null);
    try {
      const { error } = await api.POST('/v1/quotes/{id}/decline', {
        params: { path: { id: quote.id } },
      });
      if (error) {
        setDeclineError(requestErrorMessage(tErrors, error));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setDeclineError(requestErrorMessage(tErrors, undefined));
      return false;
    } finally {
      setDeclinePending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <ConfirmActionButton
          triggerLabel={t('acceptCta')}
          title={t('acceptConfirmTitle')}
          description={t('acceptConfirmDescription')}
          confirmLabel={t('acceptConfirmCta')}
          pendingLabel={t('acceptPending')}
          cancelLabel={t('acceptDismissCta')}
          hidden={!isSent}
          disabled={isExpired}
          pending={acceptPending}
          error={acceptError}
          onOpen={() => {
            setAcceptError(null);
          }}
          onConfirm={accept}
        />
        <ConfirmActionButton
          triggerLabel={t('declineCta')}
          triggerVariant="outline"
          title={t('declineConfirmTitle')}
          description={t('declineConfirmDescription')}
          confirmLabel={t('declineConfirmCta')}
          pendingLabel={t('declinePending')}
          cancelLabel={t('declineDismissCta')}
          hidden={!isSent}
          pending={declinePending}
          error={declineError}
          onOpen={() => {
            setDeclineError(null);
          }}
          onConfirm={decline}
        />
      </div>
      {acceptedBookingId ? (
        <Link
          href={`/${locale}/bookings/${acceptedBookingId}`}
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('acceptedBookingCta')}
        </Link>
      ) : null}
    </div>
  );
}
