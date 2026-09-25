'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { FeatureFlagKey } from '@photoo/shared';
import type { components } from '@photoo/api-client';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-errors';

type FeatureFlagState = components['schemas']['FeatureFlagState'];

function toFlagMap(flags: FeatureFlagState[]): Record<FeatureFlagKey, boolean> {
  const map = {} as Record<FeatureFlagKey, boolean>;
  for (const flag of flags) {
    map[flag.key] = flag.enabled;
  }
  return map;
}

export function FlagsForm({ flags }: { flags: FeatureFlagState[] }) {
  const t = useTranslations('admin.settings.flags');
  const tErrors = useTranslations('admin.settings');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const original = toFlagMap(flags);
  const [selected, setSelected] = useState<Record<FeatureFlagKey, boolean>>(() => original);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const changedFlags = flags.filter((flag) => selected[flag.key] !== original[flag.key]);
  const hasChanges = changedFlags.length > 0;

  async function handleSubmit() {
    if (!hasChanges) {
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const { error } = await api.PATCH('/v1/admin/settings', {
      body: {
        featureFlags: changedFlags.map((flag) => ({ key: flag.key, enabled: selected[flag.key] })),
      },
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
      {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">{t('title')}</legend>
        {flags.map((flag) => (
          <label key={flag.key} className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={selected[flag.key]}
              onChange={() => {
                setSelected((current) => ({ ...current, [flag.key]: !current[flag.key] }));
              }}
            />
            <span className="flex flex-col">
              <span>{t(flag.key)}</span>
              <span className="text-xs text-muted-foreground">{t(`descriptions.${flag.key}`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div>
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting || !hasChanges}
        >
          {tCommon('save')}
        </Button>
      </div>
    </div>
  );
}
