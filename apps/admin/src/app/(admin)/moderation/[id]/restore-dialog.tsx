'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { RestoreReportRequestSchema } from '@photoo/shared';

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
import { fieldErrorMessage } from '@/lib/form-errors';

interface RestoreValues {
  resolution: string;
}

// Same weight as TakedownDialog: its own confirmation, its own notice
// (docs/steps/1D.6-moderation.md: "restore ... does not reopen the report").
export function RestoreDialog({
  reportId,
  targetLabel,
  onRestored,
  onConflict,
}: {
  reportId: string;
  targetLabel: string;
  onRestored: () => void;
  onConflict: () => void;
}) {
  const t = useTranslations('admin.moderation.detail.actions.restore');
  const tActions = useTranslations('admin.moderation.detail.actions');
  const tErrors = useTranslations('admin.moderation');
  const tValidation = useTranslations('common.validation');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<RestoreValues>({
    resolver: zodResolver(RestoreReportRequestSchema),
    defaultValues: { resolution: '' },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      form.reset({ resolution: '' });
      setSubmitError(null);
    }
  }

  async function onSubmit(values: RestoreValues) {
    setSubmitError(null);
    const { error } = await api.POST('/v1/admin/reports/{id}/restore', {
      params: { path: { id: reportId } },
      body: values,
    });
    if (error) {
      if (error.code === 'TWO_FACTOR_REQUIRED') {
        return;
      }
      if (error.code === 'CONFLICT') {
        setOpen(false);
        onConflict();
        return;
      }
      setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
      return;
    }
    form.reset({ resolution: '' });
    setOpen(false);
    onRestored();
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
        <DialogDescription>{t('consequences', { targetLabel })}</DialogDescription>
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <form
          noValidate
          onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="restore-resolution">{tActions('noticeLabel')}</Label>
            <textarea
              id="restore-resolution"
              rows={4}
              aria-invalid={Boolean(form.formState.errors.resolution)}
              aria-describedby="restore-resolution-hint restore-resolution-error"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              {...form.register('resolution')}
            />
            <p id="restore-resolution-hint" className="text-xs text-muted-foreground">
              {tActions('noticeHint')}
            </p>
            <FieldError
              id="restore-resolution-error"
              message={fieldErrorMessage(tValidation, form.formState.errors.resolution)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {tCommon('cancel')}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {t('confirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
