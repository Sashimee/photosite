'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BookingDocument } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

import { areDocumentsAvailable } from './booking-status-actions';
import type { Booking } from './booking-card';

export function BookingDocumentButton({
  booking,
  document,
}: {
  booking: Booking;
  document: BookingDocument;
}) {
  const t = useTranslations('web.bookings.detail.documents');
  const tErrors = useTranslations('web.bookings');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setPending(true);
    setError(null);
    try {
      const { data, error: apiError } = await api.GET('/v1/bookings/{id}/documents/{document}', {
        params: { path: { id: booking.id, document } },
      });
      if (apiError) {
        setError(
          apiError.code === 'CONFLICT' ? t('preparing') : requestErrorMessage(tErrors, apiError),
        );
        return;
      }
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(requestErrorMessage(tErrors, undefined));
    } finally {
      setPending(false);
    }
  }

  if (!areDocumentsAvailable(booking.status)) {
    return null;
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {error ? <FormNotice tone="error">{error}</FormNotice> : null}
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        aria-busy={pending}
        onClick={() => void download()}
      >
        {pending ? t('pending') : document === 'receipt' ? t('receiptCta') : t('feeInvoiceCta')}
      </Button>
    </div>
  );
}
