'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { RejectVerificationCaseRequestSchema } from '@photoo/shared';

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
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-errors';

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

// The API only records a single free-text `reason` (RejectVerificationCaseRequestSchema
// in packages/shared has no category field, unlike docs/steps/1D.3-verification
// -queue.md's "required category" decision), so the category chosen here is
// folded into that one string rather than sent as its own field - the
// photographer still sees both, since they see the whole reason text.
const REJECTION_CATEGORIES = [
  'illegible',
  'expired',
  'nameMismatch',
  'wrongDocument',
  'suspectedForgery',
] as const;
type RejectionCategory = (typeof REJECTION_CATEGORIES)[number];

export function RejectDialog({
  caseId,
  applicantId,
  onRejected,
}: {
  caseId: string;
  applicantId: string;
  onRejected: () => void;
}) {
  const t = useTranslations('admin.verification.detail.reject');
  const tErrors = useTranslations('admin.verification');
  const tValidation = useTranslations('common.validation');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<RejectionCategory | ''>('');
  const [text, setText] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedText = text.trim();
  const reason = category ? `${t(`categories.${category}`)}: ${trimmedText}` : '';
  const parsed = category
    ? RejectVerificationCaseRequestSchema.safeParse({ reason })
    : { success: false as const };

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setCategory('');
      setText('');
      setAttempted(false);
      setSubmitError(null);
    }
  }

  async function handleConfirm() {
    setAttempted(true);
    if (!category || !trimmedText || !parsed.success) {
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const { error } = await api.POST('/v1/admin/verification-cases/{id}/reject', {
      params: { path: { id: caseId } },
      body: { reason: parsed.data.reason },
    });
    setSubmitting(false);
    if (error) {
      if (error.code !== 'TWO_FACTOR_REQUIRED') {
        setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
      }
      return;
    }
    setOpen(false);
    onRejected();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('consequences', { applicantId })}</DialogDescription>
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reject-category">{t('categoryLabel')}</Label>
          <select
            id="reject-category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as RejectionCategory | '');
            }}
            aria-invalid={attempted && !category}
            aria-describedby={attempted && !category ? 'reject-category-error' : undefined}
            className={SELECT_CLASSNAME}
          >
            <option value="">{t('categoryPlaceholder')}</option>
            {REJECTION_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {t(`categories.${value}`)}
              </option>
            ))}
          </select>
          <FieldError
            id="reject-category-error"
            message={attempted && !category ? tValidation('required') : undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reject-text">{t('textLabel')}</Label>
          <textarea
            id="reject-text"
            rows={4}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
            aria-invalid={attempted && (!trimmedText || !parsed.success)}
            aria-describedby="reject-text-hint reject-text-error"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
          <p id="reject-text-hint" className="text-xs text-muted-foreground">
            {t('textHint')}
          </p>
          <FieldError
            id="reject-text-error"
            message={
              attempted && !trimmedText
                ? tValidation('required')
                : attempted && category && !parsed.success
                  ? tValidation('tooLong')
                  : undefined
            }
          />
        </div>
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
