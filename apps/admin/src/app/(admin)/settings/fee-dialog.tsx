'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { UpdatePlatformSettingsRequestSchema } from '@photoo/shared';

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
import { apiErrorMessage } from '@/lib/api-errors';

const FeePercentSchema = UpdatePlatformSettingsRequestSchema.pick({ feePercent: true }).required();
const MAX_TWO_DECIMALS = /^\d*(\.\d{1,2})?$/;

export function FeeDialog({ currentFeePercent }: { currentFeePercent: number | null }) {
  const t = useTranslations('admin.settings.fee');
  const tErrors = useTranslations('admin.settings');
  const tValidation = useTranslations('common.validation');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newFee, setNewFee] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedNewFee = newFee.trim();
  const numericFee = trimmedNewFee === '' ? NaN : Number(trimmedNewFee);
  const hasValidDecimals = trimmedNewFee === '' || MAX_TWO_DECIMALS.test(trimmedNewFee);
  const parsed =
    Number.isFinite(numericFee) && hasValidDecimals
      ? FeePercentSchema.safeParse({ feePercent: numericFee })
      : { success: false as const };
  const trimmedConfirmText = confirmText.trim();
  const numericConfirm = trimmedConfirmText === '' ? NaN : Number(trimmedConfirmText);
  const confirmMatches =
    parsed.success && Number.isFinite(numericConfirm) && numericConfirm === parsed.data.feePercent;
  const isUnchanged = parsed.success && parsed.data.feePercent === currentFeePercent;
  const oldFeeDisplay =
    currentFeePercent === null ? t('notConfigured') : t('percent', { value: currentFeePercent });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setNewFee('');
      setConfirmText('');
      setAttempted(false);
      setSubmitError(null);
    }
  }

  async function handleConfirm() {
    setAttempted(true);
    if (!parsed.success || !confirmMatches || isUnchanged) {
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const { error } = await api.PATCH('/v1/admin/settings', {
      body: { feePercent: parsed.data.feePercent },
    });
    setSubmitting(false);
    if (error) {
      if (error.code !== 'TWO_FACTOR_REQUIRED') {
        setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
      }
      return;
    }
    handleOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {t('editTrigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('dialog.title')}</DialogTitle>
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fee-new-value">{t('dialog.newFeeLabel')}</Label>
          <Input
            id="fee-new-value"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.01}
            value={newFee}
            onChange={(event) => {
              setNewFee(event.target.value);
              setConfirmText('');
            }}
            aria-invalid={(attempted && !parsed.success) || isUnchanged}
            aria-describedby="fee-new-value-error"
          />
          <FieldError
            id="fee-new-value-error"
            message={
              attempted && !parsed.success
                ? tValidation('invalid')
                : parsed.success && isUnchanged
                  ? t('dialog.unchanged')
                  : undefined
            }
          />
        </div>
        {parsed.success ? (
          <>
            <DialogDescription>
              {t('dialog.consequences', { old: oldFeeDisplay, value: parsed.data.feePercent })}
            </DialogDescription>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fee-confirm-value">
                {t('dialog.confirmLabel', { value: parsed.data.feePercent })}
              </Label>
              <Input
                id="fee-confirm-value"
                value={confirmText}
                onChange={(event) => {
                  setConfirmText(event.target.value);
                }}
                aria-invalid={attempted && !confirmMatches}
                aria-describedby="fee-confirm-hint fee-confirm-value-error"
              />
              <p id="fee-confirm-hint" className="text-xs text-muted-foreground">
                {t('dialog.confirmHint')}
              </p>
              <FieldError
                id="fee-confirm-value-error"
                message={attempted && !confirmMatches ? t('dialog.confirmMismatch') : undefined}
              />
            </div>
          </>
        ) : null}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting || isUnchanged}
          >
            {t('dialog.confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
