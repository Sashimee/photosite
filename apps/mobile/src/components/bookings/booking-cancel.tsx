import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { CancelBookingRequestSchema } from '@photoo/shared';

import { api } from '../../lib/api';
import { canCancel, type Booking } from '../../lib/booking-status';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedPrefixTranslate,
} from '../../lib/request-errors';
import { FormNotice } from '../form/form-notice';
import { TextField } from '../form/text-field';
import { ConfirmAction } from '../requests/confirm-action';

export function BookingCancel({
  booking,
  onBookingChanged,
}: {
  booking: Booking;
  onBookingChanged: (booking: Booking) => void;
}) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCancel(booking.status)) {
    return null;
  }

  async function cancel() {
    if (inFlight.current) {
      return;
    }
    setError(null);
    const trimmed = reason.trim();
    const payload = trimmed === '' ? {} : { reason: trimmed };
    if (!CancelBookingRequestSchema.safeParse(payload).success) {
      setError(t('common.validation.tooLong'));
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      const {
        data,
        error: apiError,
        response,
      } = await api.POST('/v1/bookings/{id}/cancel', {
        params: { path: { id: booking.id } },
        body: payload,
      });
      if (data) {
        onBookingChanged(data);
      } else {
        setError(
          requestErrorMessage(
            scopedPrefixTranslate(t, 'mobile.bookings.cancel'),
            apiErrorWithStatus(apiError, response.status),
          ),
        );
      }
    } catch {
      setError(t('mobile.bookings.cancel.errors.generic'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View className="gap-3">
      {error ? (
        <FormNotice tone="error" testID="booking-cancel-error">
          {error}
        </FormNotice>
      ) : null}
      <ConfirmAction
        outline
        testID="booking-cancel"
        triggerLabel={t('mobile.bookings.cancel.cta')}
        title={t('mobile.bookings.cancel.confirmTitle')}
        description={t('mobile.bookings.cancel.confirmDescription')}
        confirmLabel={t('mobile.bookings.cancel.confirmCta')}
        pendingLabel={t('mobile.bookings.cancel.pending')}
        dismissLabel={t('mobile.bookings.cancel.dismissCta')}
        pending={pending}
        onConfirm={cancel}
      >
        <TextField
          label={t('mobile.bookings.cancel.reasonLabel')}
          value={reason}
          onChangeText={setReason}
          multiline
          editable={!pending}
          testID="booking-cancel-reason"
        />
      </ConfirmAction>
    </View>
  );
}
