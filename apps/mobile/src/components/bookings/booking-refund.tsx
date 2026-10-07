import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { CreateRefundRequestSchema, resolveLocale } from '@photoo/shared';

import { api } from '../../lib/api';
import { canRequestRefund, type Booking } from '../../lib/booking-status';
import { formatMoney, requireMoney } from '../../lib/money';
import { toAmountCents } from '../../lib/product-form';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedPrefixTranslate,
} from '../../lib/request-errors';
import { FormNotice } from '../form/form-notice';
import { PrimaryButton } from '../form/primary-button';
import { TextField } from '../form/text-field';

interface FieldErrors {
  amount?: string | undefined;
  reason?: string | undefined;
}

export function BookingRefund({
  booking,
  onBookingChanged,
}: {
  booking: Booking;
  onBookingChanged: (booking: Booking) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!canRequestRefund(booking.status) && done === null) {
    return null;
  }

  function validate() {
    const next: FieldErrors = {};
    const trimmedAmount = amount.trim();
    const trimmedReason = reason.trim();
    let amountCents: number | undefined;
    if (trimmedAmount !== '') {
      amountCents = toAmountCents(trimmedAmount);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        next.amount = t('mobile.bookings.refund.invalidAmount');
      }
    }
    if (trimmedReason === '') {
      next.reason = t('common.validation.required');
    } else if (trimmedReason.length > 2000) {
      next.reason = t('common.validation.tooLong');
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      return null;
    }
    const payload =
      amountCents === undefined
        ? { reason: trimmedReason }
        : { amountCents, reason: trimmedReason };
    return CreateRefundRequestSchema.safeParse(payload).success ? payload : null;
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
      } = await api.POST('/v1/bookings/{id}/refund', {
        params: { path: { id: booking.id } },
        body: payload,
      });
      if (data) {
        const refunded = formatMoney(requireMoney(data.amount, 'refund amount'), locale);
        const total = formatMoney(requireMoney(data.refundedTotal, 'refunded total'), locale);
        setDone(
          data.status === 'refunded'
            ? t('mobile.bookings.refund.doneFull', { amount: refunded })
            : t('mobile.bookings.refund.donePartial', { amount: refunded, total }),
        );
        setOpen(false);
        setAmount('');
        setReason('');
        onBookingChanged(data.booking);
      } else {
        const failure = apiErrorWithStatus(apiError, response.status);
        setSubmitError(
          failure.code === 'BOOKING_BUSY'
            ? t('mobile.bookings.refund.errors.busy')
            : requestErrorMessage(scopedPrefixTranslate(t, 'mobile.bookings.refund'), failure),
        );
      }
    } catch {
      setSubmitError(t('mobile.bookings.refund.errors.generic'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <View className="gap-3">
      {done ? (
        <FormNotice tone="success" testID="booking-refund-done">
          {done}
        </FormNotice>
      ) : null}
      {!canRequestRefund(booking.status) ? null : open ? (
        <View className="gap-3 rounded-md border border-border p-4" testID="booking-refund-form">
          <Text className="text-base font-semibold text-foreground">
            {t('mobile.bookings.refund.title')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.bookings.refund.description')}
          </Text>
          <TextField
            label={t('mobile.bookings.refund.amountLabel')}
            placeholder={t('mobile.bookings.refund.amountPlaceholder')}
            value={amount}
            onChangeText={(text) => {
              setAmount(text);
              setErrors((current) => ({ ...current, amount: undefined }));
            }}
            error={errors.amount}
            keyboardType="decimal-pad"
            editable={!pending}
            testID="booking-refund-amount"
          />
          <TextField
            label={t('mobile.bookings.refund.reasonLabel')}
            value={reason}
            onChangeText={(text) => {
              setReason(text);
              setErrors((current) => ({ ...current, reason: undefined }));
            }}
            error={errors.reason}
            multiline
            editable={!pending}
            testID="booking-refund-reason"
          />
          {submitError ? (
            <FormNotice tone="error" testID="booking-refund-error">
              {submitError}
            </FormNotice>
          ) : null}
          <PrimaryButton
            testID="booking-refund-submit"
            label={
              pending ? t('mobile.bookings.refund.pending') : t('mobile.bookings.refund.submitCta')
            }
            loading={pending}
            onPress={() => void submit()}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pending }}
            disabled={pending}
            onPress={() => {
              setOpen(false);
              setErrors({});
              setSubmitError(null);
            }}
            testID="booking-refund-dismiss"
            className="min-h-11 items-center justify-center"
          >
            <Text className="text-sm font-medium text-foreground underline">
              {t('mobile.bookings.refund.dismissCta')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setDone(null);
            setOpen(true);
          }}
          testID="booking-refund"
          className="min-h-11 items-center justify-center rounded-md border border-input px-4 py-3"
        >
          <Text className="text-base font-medium text-foreground">
            {t('mobile.bookings.refund.cta')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
