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

import { financeErrorMessage, isUnknownOutcome } from '../finance-errors';
import { ReasonField } from '../reason-field';

export function ReverseTransferDialog({
  bookingId,
  currency,
  reversedCents,
  disabled,
  onDone,
  onUnknownOutcome,
}: {
  bookingId: string;
  currency: string;
  reversedCents: number;
  disabled: boolean;
  onDone: () => void;
  onUnknownOutcome: () => void;
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
    if (next) {
      setOpen(true);
    } else if (!inFlight.current) {
      close();
    }
  }

  function close() {
    setOpen(false);
    setReason('');
    setReasonError(undefined);
    setSubmitError(null);
  }

  async function handleSubmit() {
    if (inFlight.current) {
      return;
    }
    const result = ReverseBookingTransferRequestSchema.safeParse({
      reason: reason.trim(),
      expectedReversedCents: reversedCents,
    });
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
      const { error, response } = await api.POST('/v1/admin/bookings/{id}/reverse-transfer', {
        params: { path: { id: bookingId } },
        body: { ...result.data, expectedReversedCents: reversedCents },
      });
      // src/lib/api.ts already redirects to re-verification for this code.
      if (error?.code === 'TWO_FACTOR_REQUIRED' || response.status === 401) {
        return;
      }
      if (isUnknownOutcome(response)) {
        close();
        onUnknownOutcome();
        return;
      }
      if (error || !response.ok) {
        setSubmitError(financeErrorMessage(tFinance, t, error));
        return;
      }
      close();
      onDone();
    } catch {
      close();
      onUnknownOutcome();
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
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
              <Button type="button" variant="ghost" disabled={submitting}>
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
