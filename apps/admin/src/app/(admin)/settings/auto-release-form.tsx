'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { UpdatePlatformSettingsRequestSchema } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-errors';

const AutoReleaseDaysSchema = UpdatePlatformSettingsRequestSchema.pick({
  autoReleaseDays: true,
}).required();

export function AutoReleaseForm({ currentDays }: { currentDays: number }) {
  const t = useTranslations('admin.settings.autoRelease');
  const tErrors = useTranslations('admin.settings');
  const tValidation = useTranslations('common.validation');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [days, setDays] = useState(String(currentDays));
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedDays = days.trim();
  const numericDays = trimmedDays === '' ? NaN : Number(trimmedDays);
  const parsed = Number.isFinite(numericDays)
    ? AutoReleaseDaysSchema.safeParse({ autoReleaseDays: numericDays })
    : { success: false as const };

  async function handleSubmit() {
    setAttempted(true);
    if (!parsed.success) {
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const { error } = await api.PATCH('/v1/admin/settings', {
      body: { autoReleaseDays: parsed.data.autoReleaseDays },
    });
    setSubmitting(false);
    if (error) {
      if (error.code !== 'TWO_FACTOR_REQUIRED') {
        setSubmitError(apiErrorMessage(tErrors, tErrors('errors.generic'), error));
      }
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-medium text-foreground">{t('title')}</h2>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auto-release-days">{t('daysLabel')}</Label>
          <Input
            id="auto-release-days"
            type="number"
            inputMode="numeric"
            min={1}
            max={60}
            value={days}
            onChange={(event) => {
              setDays(event.target.value);
            }}
            aria-invalid={attempted && !parsed.success}
            aria-describedby="auto-release-days-error"
          />
        </div>
        <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
          {tCommon('save')}
        </Button>
      </div>
      <FieldError
        id="auto-release-days-error"
        message={attempted && !parsed.success ? tValidation('invalid') : undefined}
      />
    </div>
  );
}
