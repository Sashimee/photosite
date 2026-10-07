import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { CreateDeliveryRequestSchema } from '@photoo/shared';

import { api } from '../../lib/api';
import { canDeliver, type Booking } from '../../lib/booking-status';
import { isHttpsUrl } from '../../lib/payouts';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedPrefixTranslate,
} from '../../lib/request-errors';
import { FormNotice } from '../form/form-notice';
import { PrimaryButton } from '../form/primary-button';
import { TextField } from '../form/text-field';

interface FieldErrors {
  message?: string | undefined;
  externalLink?: string | undefined;
}

export function BookingDeliveryForm({
  booking,
  onDelivered,
}: {
  booking: Booking;
  onDelivered: () => void;
}) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const [message, setMessage] = useState('');
  const [externalLink, setExternalLink] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!canDeliver(booking.status)) {
    return null;
  }

  function validate() {
    const payload = { message: message.trim(), externalLink: externalLink.trim() };
    const next: FieldErrors = {};
    const parsed = CreateDeliveryRequestSchema.safeParse(payload);
    if (payload.message === '') {
      next.message = t('common.validation.required');
    } else if (payload.message.length > 2000) {
      next.message = t('common.validation.tooLong');
    }
    if (payload.externalLink === '') {
      next.externalLink = t('common.validation.required');
    } else if (!isHttpsUrl(payload.externalLink) || !parsed.success) {
      next.externalLink = t('mobile.studio.bookings.delivery.invalidLink');
    }
    setErrors(next);
    return Object.keys(next).length === 0 ? payload : null;
  }

  async function submit() {
    if (inFlight.current) {
      return;
    }
    setSubmitError(null);
    const payload = validate();
    if (!payload) {
      return;
    }
    inFlight.current = true;
    setPending(true);
    try {
      const {
        data,
        error: apiError,
        response,
      } = await api.POST('/v1/bookings/{id}/delivery', {
        params: { path: { id: booking.id } },
        body: payload,
      });
      if (data) {
        onDelivered();
      } else {
        setSubmitError(
          requestErrorMessage(
            scopedPrefixTranslate(t, 'mobile.studio.bookings.delivery'),
            apiErrorWithStatus(apiError, response.status),
          ),
        );
      }
    } catch {
      setSubmitError(t('mobile.studio.bookings.delivery.errors.generic'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View className="gap-3 rounded-md border border-border p-4" testID="booking-delivery-form">
      <TextField
        label={t('mobile.studio.bookings.delivery.messageLabel')}
        value={message}
        onChangeText={(text) => {
          setMessage(text);
          setErrors((current) => ({ ...current, message: undefined }));
        }}
        error={errors.message}
        multiline
        editable={!pending}
        testID="booking-delivery-message"
      />
      <TextField
        label={t('mobile.studio.bookings.delivery.linkLabel')}
        hint={t('mobile.studio.bookings.delivery.linkHint')}
        value={externalLink}
        onChangeText={(text) => {
          setExternalLink(text);
          setErrors((current) => ({ ...current, externalLink: undefined }));
        }}
        error={errors.externalLink}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!pending}
        testID="booking-delivery-link"
      />
      {submitError ? (
        <FormNotice tone="error" testID="booking-delivery-error">
          {submitError}
        </FormNotice>
      ) : null}
      <PrimaryButton
        testID="booking-delivery-submit"
        label={t('mobile.studio.bookings.delivery.submitCta')}
        loading={pending}
        onPress={() => void submit()}
      />
    </View>
  );
}
