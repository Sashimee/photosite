'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import { RefundBookingRequestSchema } from '@photoo/shared';

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
import { api } from '@/lib/api';
import { formatCents, minorUnitDigits, parseAmountToCents } from '@/lib/money';

import { financeErrorMessage } from '../finance-errors';
import { ReasonField } from '../reason-field';

interface Errors {
  amount?: string;
  reason?: string;
}

export function RefundDialog({
  bookingId,
  currency,
  refundableCents,
  onDone,
}: {
  bookingId: string;
  currency: string;
  refundableCents: number;
  onDone: () => void;
}) {
  const t = useTranslations('admin.finance.refund');
  const tFinance = useTranslations('admin.finance');
  const tCommon = useTranslations('common');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const parsed = parseAmountToCents(amount, currency);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setAmount('');
      setReason('');
      setErrors({});
      setSubmitError(null);
    }
  }

  function amountError(): string | undefined {
    if (parsed.ok) {
      return undefined;
    }
    switch (parsed.reason) {
      case 'notPositive':
        return t('errors.amountNotPositive');
      case 'tooManyDecimals':
        return t('errors.amountTooManyDecimals', {
          currency,
          digits: minorUnitDigits(currency),
        });
      case 'tooLarge':
        return t('errors.amountTooLarge');
      case 'invalid':
        return t('errors.amountInvalid');
    }
  }

  async function handleSubmit() {
    if (inFlight.current) {
      return;
    }
    const nextErrors: Errors = {};
    const amountMessage = amountError();
    if (amountMessage) {
      nextErrors.amount = amountMessage;
    }
    const request = {
      amountCents: parsed.ok ? parsed.amountCents : 0,
      reason: reason.trim(),
    };
    const result = RefundBookingRequestSchema.safeParse(request);
    if (!result.success) {
      for (const issue of result.error.issues) {
        if (issue.path[0] === 'reason') {
          nextErrors.reason =
            issue.code === 'too_big' ? t('errors.reasonTooLong') : t('errors.reasonRequired');
        }
      }
    }
    if (!result.success || nextErrors.amount) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setSubmitError(null);
    inFlight.current = true;
    setSubmitting(true);
    try {
      const { error } = await api.POST('/v1/admin/bookings/{id}/refund', {
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
        <Button type="button">{t('open')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
        <p className="text-sm text-foreground">
          {parsed.ok
            ? t('summary', {
                amount: formatCents(format, parsed.amountCents, currency),
                currency,
                id: bookingId,
              })
            : bookingId}
        </p>
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="refund-amount">{t('amountLabel', { currency })}</Label>
            <Input
              id="refund-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
              }}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby="refund-amount-hint refund-amount-error"
            />
            <p id="refund-amount-hint" className="text-xs text-muted-foreground">
              {t('amountHint', { refundable: formatCents(format, refundableCents, currency) })}
            </p>
            <FieldError id="refund-amount-error" message={errors.amount} />
          </div>
          <ReasonField
            id="refund-reason"
            label={t('reasonLabel')}
            value={reason}
            error={errors.reason}
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
