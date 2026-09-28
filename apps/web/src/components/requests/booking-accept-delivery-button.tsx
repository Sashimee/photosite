'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

import { canAcceptDelivery } from './booking-status-actions';
import { ConfirmActionButton } from './confirm-action-button';
import type { Booking } from './booking-card';

export function BookingAcceptDeliveryButton({ booking }: { booking: Booking }) {
  const t = useTranslations('web.bookings.detail.acceptDelivery');
  const tErrors = useTranslations('web.bookings');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acceptDelivery(): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const { error: apiError } = await api.POST('/v1/bookings/{id}/accept-delivery', {
        params: { path: { id: booking.id } },
      });
      if (apiError) {
        setError(requestErrorMessage(tErrors, apiError));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(requestErrorMessage(tErrors, undefined));
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <ConfirmActionButton
      triggerLabel={t('cta')}
      title={t('confirmTitle')}
      description={t('confirmDescription')}
      confirmLabel={t('confirmCta')}
      pendingLabel={t('pending')}
      cancelLabel={t('dismissCta')}
      hidden={!canAcceptDelivery(booking.status)}
      pending={pending}
      error={error}
      onOpen={() => {
        setError(null);
      }}
      onConfirm={acceptDelivery}
    />
  );
}
