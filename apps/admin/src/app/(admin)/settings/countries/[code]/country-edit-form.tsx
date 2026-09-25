'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { SUPPORTED_LOCALES, UpdateCountryRequestSchema, type Locale } from '@photoo/shared';
import type { components } from '@photoo/api-client';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-errors';

type AdminCountry = components['schemas']['AdminCountry'];

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

const CountryEditSchema = UpdateCountryRequestSchema.pick({
  vatRate: true,
  defaultLocale: true,
}).required();

export function CountryEditForm({ country }: { country: AdminCountry }) {
  const t = useTranslations('admin.settings.detail.edit');
  const tErrors = useTranslations('admin.settings');
  const tValidation = useTranslations('common.validation');
  const tCommon = useTranslations('common');
  const tLocale = useTranslations('locale');
  const router = useRouter();
  const [vatRate, setVatRate] = useState(String(country.vatRate));
  const [defaultLocale, setDefaultLocale] = useState<Locale>(country.defaultLocale);
  const [attempted, setAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmedVatRate = vatRate.trim();
  const numericVatRate = trimmedVatRate === '' ? NaN : Number(trimmedVatRate);
  const parsed = Number.isFinite(numericVatRate)
    ? CountryEditSchema.safeParse({ vatRate: numericVatRate, defaultLocale })
    : { success: false as const };

  async function handleSubmit() {
    setAttempted(true);
    if (!parsed.success) {
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    const { error } = await api.PATCH('/v1/admin/countries/{code}', {
      params: { path: { code: country.code } },
      body: { vatRate: parsed.data.vatRate, defaultLocale: parsed.data.defaultLocale },
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
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-foreground">{t('title')}</h2>
      {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="country-vat-rate">{t('vatRateLabel')}</Label>
          <Input
            id="country-vat-rate"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.01}
            value={vatRate}
            onChange={(event) => {
              setVatRate(event.target.value);
            }}
            aria-invalid={attempted && !parsed.success}
            aria-describedby="country-vat-rate-error"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="country-default-locale">{t('defaultLocaleLabel')}</Label>
          <select
            id="country-default-locale"
            value={defaultLocale}
            onChange={(event) => {
              setDefaultLocale(event.target.value as Locale);
            }}
            className={SELECT_CLASSNAME}
          >
            {SUPPORTED_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {tLocale(locale)}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
          {tCommon('save')}
        </Button>
      </div>
      <FieldError
        id="country-vat-rate-error"
        message={attempted && !parsed.success ? tValidation('invalid') : undefined}
      />
    </div>
  );
}
