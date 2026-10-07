import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { BookingDocument } from '@photoo/shared';

import { api } from '../../lib/api';
import { areDocumentsAvailable, type Booking } from '../../lib/booking-status';
import { isHttpsUrl } from '../../lib/payouts';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedPrefixTranslate,
} from '../../lib/request-errors';
import { FormNotice } from '../form/form-notice';
import { PrimaryButton } from '../form/primary-button';

export function BookingDocumentButton({
  booking,
  document,
}: {
  booking: Booking;
  document: BookingDocument;
}) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!areDocumentsAvailable(booking.status)) {
    return null;
  }

  async function open() {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const {
        data,
        error: apiError,
        response,
      } = await api.GET('/v1/bookings/{id}/documents/{document}', {
        params: { path: { id: booking.id, document } },
      });
      if (!data) {
        const failure = apiErrorWithStatus(apiError, response.status);
        setError(
          failure.code === 'CONFLICT'
            ? t('mobile.bookings.documents.preparing')
            : requestErrorMessage(scopedPrefixTranslate(t, 'mobile.bookings.documents'), failure),
        );
        return;
      }
      if (!isHttpsUrl(data.url)) {
        setError(t('mobile.bookings.documents.errors.generic'));
        return;
      }
      await WebBrowser.openBrowserAsync(data.url);
    } catch {
      setError(t('mobile.bookings.documents.errors.generic'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View className="gap-3">
      {error ? (
        <FormNotice tone="error" testID={`booking-document-${document}-error`}>
          {error}
        </FormNotice>
      ) : null}
      <PrimaryButton
        testID={`booking-document-${document}`}
        label={
          pending
            ? t('mobile.bookings.documents.pending')
            : document === 'receipt'
              ? t('mobile.bookings.documents.receiptCta')
              : t('mobile.bookings.documents.feeInvoiceCta')
        }
        loading={pending}
        onPress={() => void open()}
      />
    </View>
  );
}
