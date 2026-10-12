'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { CreateRefundRequestSchema } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fieldErrorMessage } from '@/lib/form-errors';
import { requestErrorMessage } from '@/lib/request-errors';

import { parseAmountToCents } from './booking-refund-dialog-helpers';
import { canRequestRefund } from './booking-status-actions';
import type { Booking } from './booking-card';

interface RefundFormValues {
  amount: string;
  reason: string;
}

export function BookingRefundDialog({ booking }: { booking: Booking }) {
  const t = useTranslations('web.bookings.detail.refund');
  const tErrors = useTranslations('web.bookings');
  const tValidation = useTranslations('common.validation');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    reset,
    formState: { errors },
  } = useForm<RefundFormValues>({ defaultValues: { amount: '', reason: '' } });

  function handleOpenChange(next: boolean) {
    if (pending) {
      return;
    }
    setOpen(next);
    setSubmitError(null);
    clearErrors();
    reset({ amount: '', reason: '' });
  }

  async function onSubmit(values: RefundFormValues) {
    setSubmitError(null);
    clearErrors();

    const trimmedAmount = values.amount.trim();
    let amountCents: number | undefined;
    if (trimmedAmount !== '') {
      const parsed = parseAmountToCents(trimmedAmount);
      if (parsed === null) {
        setError('amount', { type: 'custom', message: t('invalidAmount') });
        return;
      }
      amountCents = parsed;
    }

    const payload =
      amountCents === undefined
        ? { reason: values.reason }
        : { amountCents, reason: values.reason };
    const result = CreateRefundRequestSchema.safeParse(payload);
    if (!result.success) {
      let hasFieldError = false;
      for (const issue of result.error.issues) {
        if (issue.path[0] === 'reason') {
          setError('reason', { type: issue.code });
          hasFieldError = true;
        } else if (issue.path[0] === 'amountCents') {
          setError('amount', { type: issue.code });
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
      const { error } = await api.POST('/v1/bookings/{id}/refund', {
        params: { path: { id: booking.id } },
        body: payload,
      });
      if (error) {
        setSubmitError(requestErrorMessage(tErrors, error));
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setSubmitError(requestErrorMessage(tErrors, undefined));
    } finally {
      setPending(false);
    }
  }

  if (!canRequestRefund(booking.status)) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {t('cta')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold text-foreground">{t('title')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('description')}
        </DialogDescription>
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booking-refund-amount">{t('amountLabel')}</Label>
            <Input
              id="booking-refund-amount"
              inputMode="decimal"
              placeholder={t('amountPlaceholder')}
              aria-invalid={Boolean(errors.amount)}
              {...register('amount')}
            />
            <FieldError
              id="booking-refund-amount-error"
              message={errors.amount?.message ?? fieldErrorMessage(tValidation, errors.amount)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booking-refund-reason">{t('reasonLabel')}</Label>
            <Textarea
              id="booking-refund-reason"
              aria-invalid={Boolean(errors.reason)}
              {...register('reason')}
            />
            <FieldError
              id="booking-refund-reason-error"
              message={fieldErrorMessage(tValidation, errors.reason)}
            />
          </div>
          <div className="flex justify-end gap-3">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                {t('cancelCta')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? t('pending') : t('submitCta')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
