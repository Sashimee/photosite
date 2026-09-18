'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { SuspendUserRequestSchema } from '@photoo/shared';
import type { components } from '@photoo/api-client';

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

type AdminUser = components['schemas']['User'];
interface SuspendValues {
  reason: string;
}

export function SuspendDialog({ user, onSuspended }: { user: AdminUser; onSuspended: () => void }) {
  const t = useTranslations('admin.users.detail.suspend');
  const tErrors = useTranslations('admin.users');
  const tValidation = useTranslations('common.validation');
  const tCommon = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<SuspendValues>({
    resolver: zodResolver(SuspendUserRequestSchema),
    defaultValues: { reason: '' },
  });

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      form.reset();
      setSubmitError(null);
    }
  }

  async function onSubmit(values: SuspendValues) {
    setSubmitError(null);
    const { error } = await api.POST('/v1/admin/users/{id}/suspend', {
      params: { path: { id: user.id } },
      body: values,
    });
    if (error) {
      // src/lib/api.ts already redirects to re-verification for this code;
      // a toast here would just flash behind that navigation.
      if (error.code !== 'TWO_FACTOR_REQUIRED') {
        setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
      }
      return;
    }
    form.reset();
    setOpen(false);
    onSuspended();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">{t('trigger')}</Button>
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
            <Label htmlFor="suspend-reason">{t('reasonLabel')}</Label>
            <textarea
              id="suspend-reason"
              rows={3}
              aria-invalid={Boolean(form.formState.errors.reason)}
              aria-describedby={form.formState.errors.reason ? 'suspend-reason-error' : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              {...form.register('reason')}
            />
            <p className="text-xs text-muted-foreground">{t('reasonHint')}</p>
            <FieldError
              id="suspend-reason-error"
              message={fieldErrorMessage(tValidation, form.formState.errors.reason)}
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
