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
import { centsToAmountInput, formatCents, minorUnitDigits, parseAmountToCents } from '@/lib/money';

import { financeErrorMessage, isUnknownOutcome, pendingReversalCents } from '../finance-errors';
import { ReasonField } from '../reason-field';

interface Errors {
  amount?: string;
  reason?: string;
}

export function RefundDialog({
  bookingId,
  currency,
  refundedCents,
  refundableCents,
  disabled,
  onDone,
  onUnknownOutcome,
}: {
  bookingId: string;
  currency: string;
  refundedCents: number;
  refundableCents: number;
  disabled: boolean;
  onDone: () => void;
  onUnknownOutcome: () => void;
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
  const [pendingCents, setPendingCents] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  const parsed = parseAmountToCents(amount, currency);

  function handleOpenChange(next: boolean) {
    if (next) {
      setOpen(true);
    } else if (!inFlight.current) {
      close();
    }
  }

  function close() {
    setOpen(false);
    setAmount('');
    setReason('');
    setErrors({});
    setSubmitError(null);
    setPendingCents(null);
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
      expectedRefundedCents: refundedCents,
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
    setPendingCents(null);
    inFlight.current = true;
    setSubmitting(true);
    try {
      const { error, response } = await api.POST('/v1/admin/bookings/{id}/refund', {
        params: { path: { id: bookingId } },
        body: { ...result.data, expectedRefundedCents: refundedCents },
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
        setSubmitError(
          financeErrorMessage(tFinance, t, error, (cents) => formatCents(format, cents, currency)),
        );
        setPendingCents(pendingReversalCents(error) ?? null);
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
        <Button type="button" disabled={disabled}>
          {t('open')}
        </Button>
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
        {pendingCents === null ? null : (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setAmount(centsToAmountInput(pendingCents, currency));
              setErrors({});
            }}
          >
            {t('usePending', { amount: formatCents(format, pendingCents, currency) })}
          </Button>
        )}
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
              aria-describedby="refund-amount-hint refund-amount-max refund-amount-error"
            />
            <p id="refund-amount-hint" className="text-xs text-muted-foreground">
              {t('amountHint')}
            </p>
            <p id="refund-amount-max" className="text-xs text-muted-foreground">
              {t('amountMax', { amount: formatCents(format, refundableCents, currency) })}
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
