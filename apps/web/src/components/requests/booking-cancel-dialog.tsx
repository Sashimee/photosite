'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { CancelBookingRequestSchema } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormNotice } from '@/components/ui/form-message';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

import { canCancel } from './booking-status-actions';
import type { Booking } from './booking-card';

interface CancelFormValues {
  reason: string;
}

export function BookingCancelDialog({ booking }: { booking: Booking }) {
  const t = useTranslations('web.bookings.detail.cancel');
  const tErrors = useTranslations('web.bookings');
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { register, handleSubmit, reset } = useForm<CancelFormValues>({
    defaultValues: { reason: '' },
  });

  function handleOpenChange(next: boolean) {
    if (pending) {
      return;
    }
    setOpen(next);
    setSubmitError(null);
    reset({ reason: '' });
  }

  async function onSubmit(values: CancelFormValues) {
    setSubmitError(null);
    const reason = values.reason.trim();
    const payload = reason === '' ? {} : { reason };
    const result = CancelBookingRequestSchema.safeParse(payload);
    if (!result.success) {
      setSubmitError(requestErrorMessage(tErrors, undefined));
      return;
    }

    setPending(true);
    try {
      const { error } = await api.POST('/v1/bookings/{id}/cancel', {
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

  if (!canCancel(booking.status)) {
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
        <DialogTitle className="text-lg font-semibold text-foreground">
          {t('confirmTitle')}
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {t('confirmDescription')}
        </DialogDescription>
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booking-cancel-reason">{t('reasonLabel')}</Label>
            <Textarea id="booking-cancel-reason" {...register('reason')} />
          </div>
          <div className="flex justify-end gap-3">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                {t('dismissCta')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending} aria-busy={pending}>
              {pending ? t('pending') : t('confirmCta')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
