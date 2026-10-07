import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '../../lib/api';
import { canAcceptDelivery, type Booking } from '../../lib/booking-status';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedPrefixTranslate,
} from '../../lib/request-errors';
import { FormNotice } from '../form/form-notice';
import { ConfirmAction } from '../requests/confirm-action';

export function BookingAcceptDelivery({
  booking,
  onBookingChanged,
}: {
  booking: Booking;
  onBookingChanged: (booking: Booking) => void;
}) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canAcceptDelivery(booking.status)) {
    return null;
  }

  async function accept() {
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
      } = await api.POST('/v1/bookings/{id}/accept-delivery', {
        params: { path: { id: booking.id } },
      });
      if (data) {
        setAccepted(true);
        onBookingChanged(data);
      } else {
        setError(
          requestErrorMessage(
            scopedPrefixTranslate(t, 'mobile.bookings.acceptDelivery'),
            apiErrorWithStatus(apiError, response.status),
          ),
        );
      }
    } catch {
      setError(t('mobile.bookings.acceptDelivery.errors.generic'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View className="gap-3">
      {error ? (
        <FormNotice tone="error" testID="booking-accept-delivery-error">
          {error}
        </FormNotice>
      ) : null}
      {accepted ? (
        <FormNotice tone="success" testID="booking-accept-delivery-done">
          {t('mobile.bookings.acceptDelivery.done')}
        </FormNotice>
      ) : (
        <ConfirmAction
          testID="booking-accept-delivery"
          triggerLabel={t('mobile.bookings.acceptDelivery.cta')}
          title={t('mobile.bookings.acceptDelivery.confirmTitle')}
          description={t('mobile.bookings.acceptDelivery.confirmDescription')}
          confirmLabel={t('mobile.bookings.acceptDelivery.confirmCta')}
          pendingLabel={t('mobile.bookings.acceptDelivery.pending')}
          dismissLabel={t('mobile.bookings.acceptDelivery.dismissCta')}
          pending={pending}
          onConfirm={accept}
        />
      )}
    </View>
  );
}
