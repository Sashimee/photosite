'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-errors';

type AdminCountry = components['schemas']['AdminCountry'];

export function CountryToggleDialog({
  country,
  onToggled,
}: {
  country: AdminCountry;
  onToggled: () => void;
}) {
  const t = useTranslations('admin.settings.countries');
  const tErrors = useTranslations('admin.settings');
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
    const { error } = await api.PATCH('/v1/admin/countries/{code}', {
      params: { path: { code: country.code } },
      body: { enabled: !country.enabled },
    });
    setSubmitting(false);
    if (error) {
      if (error.code !== 'TWO_FACTOR_REQUIRED') {
        setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
      }
      return;
    }
    setOpen(false);
    onToggled();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {country.enabled ? t('toggle.disableTrigger') : t('toggle.enableTrigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>
          {country.enabled
            ? t('toggle.disableTitle', { name: country.name })
            : t('toggle.enableTitle', { name: country.name })}
        </DialogTitle>
        <DialogDescription>
          {country.enabled
            ? t('toggle.disableConsequences', { name: country.name, count: country.accountCount })
            : t('toggle.enableConsequences', { name: country.name, count: country.accountCount })}
        </DialogDescription>
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {tCommon('cancel')}
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void handleConfirm()} disabled={submitting}>
            {country.enabled ? t('toggle.disableConfirm') : t('toggle.enableConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
