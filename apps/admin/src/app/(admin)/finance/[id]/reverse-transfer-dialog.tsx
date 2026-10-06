'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { ReverseBookingTransferRequestSchema } from '@photoo/shared';

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
import { api } from '@/lib/api';

import { financeErrorMessage } from '../finance-errors';
import { ReasonField } from '../reason-field';

export function ReverseTransferDialog({
  bookingId,
  currency,
  onDone,
}: {
  bookingId: string;
  currency: string;
  onDone: () => void;
}) {
  const t = useTranslations('admin.finance.reverse');
  const tFinance = useTranslations('admin.finance');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setReason('');
      setReasonError(undefined);
      setSubmitError(null);
    }
  }

  async function handleSubmit() {
    if (inFlight.current) {
      return;
    }
    const result = ReverseBookingTransferRequestSchema.safeParse({ reason: reason.trim() });
    if (!result.success) {
      const issue = result.error.issues[0];
      setReasonError(
        issue?.code === 'too_big' ? t('errors.reasonTooLong') : t('errors.reasonRequired'),
      );
      return;
    }
    setReasonError(undefined);
    setSubmitError(null);
    inFlight.current = true;
    setSubmitting(true);
    try {
      const { error } = await api.POST('/v1/admin/bookings/{id}/reverse-transfer', {
        params: { path: { id: bookingId } },
        body: result.data,
      });
      if (error) {
        // src/lib/api.ts already redirects to re-verification for this code.
        if (error.code === 'TWO_FACTOR_REQUIRED') {
          return;
        }
        setSubmitError(financeErrorMessage(tFinance, t, error));
        return;
      }
      handleOpenChange(false);
      onDone();
    } catch {
      setSubmitError(tFinance('errors.generic'));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
        <p className="text-sm text-foreground">{t('summary', { currency, id: bookingId })}</p>
        <FormNotice>{t('twoFactorNotice')}</FormNotice>
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <ReasonField
            id="reverse-reason"
            label={t('reasonLabel')}
            value={reason}
            error={reasonError}
            onChange={setReason}
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tCommon('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {submitting ? t('submitting') : t('submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
