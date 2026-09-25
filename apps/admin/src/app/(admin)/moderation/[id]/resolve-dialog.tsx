'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { ResolveReportRequestSchema } from '@photoo/shared';

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

interface ResolveValues {
  status: 'resolved' | 'dismissed';
  resolution: string;
}

// Backs both "resolve" and "dismiss": the API is the same endpoint with a
// different `status`, and the notice-text field carries the same weight
// either way (docs/steps/1D.6-moderation.md: "the field label says it is
// sent to the reporter and the owner").
export function ResolveDialog({
  reportId,
  status,
  onDecided,
  onConflict,
}: {
  reportId: string;
  status: 'resolved' | 'dismissed';
  onDecided: () => void;
  onConflict: () => void;
}) {
  const actionKey = status === 'resolved' ? 'resolve' : 'dismiss';
  const t = useTranslations(`admin.moderation.detail.actions.${actionKey}`);
  const tActions = useTranslations('admin.moderation.detail.actions');
  const tErrors = useTranslations('admin.moderation');
  const tValidation = useTranslations('common.validation');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<ResolveValues>({
    resolver: zodResolver(ResolveReportRequestSchema),
    defaultValues: { status, resolution: '' },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      form.reset({ status, resolution: '' });
      setSubmitError(null);
    }
  }

  async function onSubmit(values: ResolveValues) {
    setSubmitError(null);
    const { error } = await api.POST('/v1/admin/reports/{id}/resolve', {
      params: { path: { id: reportId } },
      body: values,
    });
    if (error) {
      // src/lib/api.ts already redirects to re-verification for this code;
      // a toast here would just flash behind that navigation.
      if (error.code === 'TWO_FACTOR_REQUIRED') {
        return;
      }
      // Two moderators opening the same open report is expected, not an
      // error toast (docs/steps/1D.6-moderation.md); `onConflict` refreshes
      // the report and names who resolved it first.
      if (error.code === 'CONFLICT') {
        setOpen(false);
        onConflict();
        return;
      }
      setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
      return;
    }
    form.reset({ status, resolution: '' });
    setOpen(false);
    onDecided();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant={status === 'resolved' ? 'default' : 'outline'}>
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('consequences')}</DialogDescription>
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <form
          noValidate
          onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${status}-resolution`}>{tActions('noticeLabel')}</Label>
            <textarea
              id={`${status}-resolution`}
              rows={4}
              aria-invalid={Boolean(form.formState.errors.resolution)}
              aria-describedby={`${status}-resolution-hint ${status}-resolution-error`}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              {...form.register('resolution')}
            />
            <p id={`${status}-resolution-hint`} className="text-xs text-muted-foreground">
              {tActions('noticeHint')}
            </p>
            <FieldError
              id={`${status}-resolution-error`}
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
