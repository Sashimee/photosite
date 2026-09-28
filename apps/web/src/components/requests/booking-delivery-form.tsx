'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { CreateDeliveryRequestSchema } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fieldErrorMessage } from '@/lib/form-errors';
import { requestErrorMessage } from '@/lib/request-errors';

import { canDeliver } from './booking-status-actions';
import type { Booking } from './booking-card';

interface DeliveryFormValues {
  message: string;
  externalLink: string;
}

export function BookingDeliveryForm({ booking }: { booking: Booking }) {
  const t = useTranslations('web.bookings.detail.delivery');
  const tErrors = useTranslations('web.bookings');
  const tValidation = useTranslations('common.validation');
  const router = useRouter();

  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DeliveryFormValues>({ defaultValues: { message: '', externalLink: '' } });

  async function onSubmit(values: DeliveryFormValues) {
    setSubmitError(null);
    setSuccess(false);

    if (values.externalLink.trim() === '') {
      setError('externalLink', { type: 'invalid_type' });
      return;
    }

    const payload = { message: values.message, externalLink: values.externalLink };
    const result = CreateDeliveryRequestSchema.safeParse(payload);
    if (!result.success) {
      let hasFieldError = false;
      for (const issue of result.error.issues) {
        if (issue.path[0] === 'message') {
          setError('message', { type: issue.code });
          hasFieldError = true;
        } else if (issue.path[0] === 'externalLink' || issue.path[0] === 'fileIds') {
          setError('externalLink', { type: issue.code });
          hasFieldError = true;
        }
      }
      if (!hasFieldError) {
        setSubmitError(requestErrorMessage(tErrors, undefined));
      }
      return;
    }

    setPending(true);
    try {
      const { error } = await api.POST('/v1/bookings/{id}/delivery', {
        params: { path: { id: booking.id } },
        body: payload,
      });
      if (error) {
        setSubmitError(requestErrorMessage(tErrors, error));
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch {
      setSubmitError(requestErrorMessage(tErrors, undefined));
    } finally {
      setPending(false);
    }
  }

  if (!canDeliver(booking.status)) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
      {success ? <FormNotice tone="success">{t('success')}</FormNotice> : null}
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="booking-delivery-message">{t('messageLabel')}</Label>
          <Textarea
            id="booking-delivery-message"
            aria-invalid={Boolean(errors.message)}
            {...register('message')}
          />
          <FieldError
            id="booking-delivery-message-error"
            message={fieldErrorMessage(tValidation, errors.message)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="booking-delivery-link">{t('externalLinkLabel')}</Label>
          <Input
            id="booking-delivery-link"
            type="url"
            aria-invalid={Boolean(errors.externalLink)}
            {...register('externalLink')}
          />
          <FieldError
            id="booking-delivery-link-error"
            message={fieldErrorMessage(tValidation, errors.externalLink)}
          />
        </div>
        <Button type="submit" disabled={pending} aria-busy={pending} className="self-start">
          {pending ? t('pending') : t('submitCta')}
        </Button>
      </form>
    </div>
  );
}
