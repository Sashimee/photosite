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

import {
  DecisionFields,
  emptyDecisionDraft,
  validateDecision,
  type DecisionDraft,
  type DecisionErrors,
} from '../decision-form';

const ALL_STATUSES = ['approved', 'flagged', 'rejected'] as const;

export function DecisionDialog({ checkId, onDecided }: { checkId: string; onDecided: () => void }) {
  const t = useTranslations('admin.provenance.detail.actions');
  const tErrors = useTranslations('admin.provenance');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DecisionDraft>(() => emptyDecisionDraft('approved'));
  const [errors, setErrors] = useState<DecisionErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setDraft(emptyDecisionDraft('approved'));
      setErrors({});
      setSubmitError(null);
    }
  }

  async function handleSubmit() {
    const validated = validateDecision(draft);
    if ('errors' in validated) {
      setErrors(validated.errors);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setSubmitting(true);
    try {
      const { error } = await api.POST('/v1/admin/provenance/{id}/decision', {
        params: { path: { id: checkId } },
        body: validated.request,
      });
      if (error) {
        // src/lib/api.ts already redirects to re-verification for this code.
        if (error.code === 'TWO_FACTOR_REQUIRED') {
          return;
        }
        setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
        return;
      }
      handleOpenChange(false);
      onDecided();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button">{t('decide')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('dialogTitle')}</DialogTitle>
        <DialogDescription>{t('consequences')}</DialogDescription>
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <DecisionFields
            idPrefix="decision"
            draft={draft}
            errors={errors}
            statuses={ALL_STATUSES}
            onChange={setDraft}
          />
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tCommon('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={submitting}>
              {t('confirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
