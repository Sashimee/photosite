'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
import { apiErrorMessage } from '@/lib/api-errors';

export function ApproveDialog({
  caseId,
  applicantId,
  onApproved,
}: {
  caseId: string;
  applicantId: string;
  onApproved: () => void;
}) {
  const t = useTranslations('admin.verification.detail.approve');
  const tErrors = useTranslations('admin.verification');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setSubmitError(null);
    }
  }

  async function handleConfirm() {
    setSubmitError(null);
    setSubmitting(true);
    const { error } = await api.POST('/v1/admin/verification-cases/{id}/approve', {
      params: { path: { id: caseId } },
    });
    setSubmitting(false);
    if (error) {
      if (error.code !== 'TWO_FACTOR_REQUIRED') {
        setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
      }
      return;
    }
    setOpen(false);
    onApproved();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button">{t('trigger')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('consequences', { applicantId })}</DialogDescription>
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void handleConfirm()} disabled={submitting}>
            {t('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
