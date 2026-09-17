'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import type { components } from '@photoo/api-client';
import {
  CreateRequestRequestSchema,
  LICENCE_USAGES,
  PHOTOGRAPHER_CATEGORIES,
} from '@photoo/shared';
import type { Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fieldErrorMessage } from '@/lib/form-errors';
import { requestErrorMessage } from '@/lib/request-errors';

import { LocationPicker, type PickedLocation } from './location-picker';
import {
  buildCreateRequestPayload,
  EMPTY_REQUEST_FORM_VALUES,
  mapCreateRequestIssuePath,
  mapValidationErrorDetailPath,
  type RequestFormValues,
} from './request-form-helpers';

type CountrySummary = components['schemas']['CountrySummary'];

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export function RequestForm({
  locale,
  countries,
}: {
  locale: Locale;
  countries: CountrySummary[];
}) {
  const t = useTranslations('web.requests.new.form');
  const tCategories = useTranslations('common.categories');
  const tLicenceUsages = useTranslations('common.licenceUsages');
  const tValidation = useTranslations('common.validation');
  const tErrors = useTranslations('web.requests');
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    setError,
    clearErrors,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RequestFormValues>({ defaultValues: EMPTY_REQUEST_FORM_VALUES });

  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const addressCountryCode = watch('addressCountryCode');
  const currency =
    countries.find((country) => country.code === addressCountryCode)?.currency ?? null;

  async function onSubmit(values: RequestFormValues) {
    setSubmitError(null);
    setLocationError(null);
    clearErrors();

    if (!location) {
      setLocationError(t('locationRequired'));
      return;
    }

    const payload = buildCreateRequestPayload(values, location, currency);
    // Runs the same zod contract the API enforces so client-side errors
    // mirror server-side ones field for field.
    const result = CreateRequestRequestSchema.safeParse(payload);
    if (!result.success) {
      let hasFieldError = false;
      for (const issue of result.error.issues) {
        const field = mapCreateRequestIssuePath(issue.path);
        if (field === 'budgetMax' && issue.code === 'custom') {
          setError(field, { type: issue.code, message: t('budgetMinGreaterThanMax') });
          hasFieldError = true;
        } else if (field) {
          setError(field, { type: issue.code });
          hasFieldError = true;
        } else if (issue.path[0] === 'location') {
          setLocationError(t('locationRequired'));
        }
      }
      if (!hasFieldError) {
        setSubmitError(tErrors('errors.invalid'));
      }
      return;
    }

    try {
      // zod's `.optional()` widens `address.line2` to `string | undefined`,
      // which `exactOptionalPropertyTypes` rejects against the API's
      // `line2?: string`; `payload.address`'s own conditional spread stays
      // cleanly optional, and is value-identical since parsing didn't transform it.
      const { data, error } = await api.POST('/v1/requests', {
        body: { ...result.data, address: payload.address },
      });
      if (error) {
        if (error.code === 'VALIDATION_ERROR') {
          const fields = mapValidationErrorDetailPath(error.details);
          const hasFieldError = fields.some((field) => field !== null);
          for (const field of fields) {
            if (field) {
              setError(field, { type: 'custom' });
            }
          }
          if (!hasFieldError) {
            setSubmitError(requestErrorMessage(tErrors, error));
          }
          return;
        }
        setSubmitError(requestErrorMessage(tErrors, error));
        return;
      }
      router.push(`/${locale}/requests/${data.id}`);
      router.refresh();
    } catch {
      setSubmitError(requestErrorMessage(tErrors, undefined));
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-8"
    >
      {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="request-title">{t('titleLabel')}</Label>
          <Input id="request-title" aria-invalid={Boolean(errors.title)} {...register('title')} />
          <FieldError
            id="request-title-error"
            message={fieldErrorMessage(tValidation, errors.title)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="request-category">{t('categoryLabel')}</Label>
          <select
            id="request-category"
            aria-invalid={Boolean(errors.category)}
            className={SELECT_CLASSNAME}
            {...register('category')}
          >
            <option value="">{t('categoryPlaceholder')}</option>
            {PHOTOGRAPHER_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {tCategories(category)}
              </option>
            ))}
          </select>
          <FieldError
            id="request-category-error"
            message={fieldErrorMessage(tValidation, errors.category)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="request-description">{t('descriptionLabel')}</Label>
          <Textarea
            id="request-description"
            aria-invalid={Boolean(errors.description)}
            {...register('description')}
          />
          <FieldError
            id="request-description-error"
            message={fieldErrorMessage(tValidation, errors.description)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="request-event-date">{t('eventDateLabel')}</Label>
          <Input
            id="request-event-date"
            type="datetime-local"
            aria-invalid={Boolean(errors.eventDate)}
            {...register('eventDate')}
          />
          <FieldError
            id="request-event-date-error"
            message={fieldErrorMessage(tValidation, errors.eventDate)}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" className="size-4" {...register('dateFlexible')} />
          {t('dateFlexibleLabel')}
        </label>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('locationHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('locationExplanation')}</p>
        </div>
        <LocationPicker
          location={location}
          onLocationChange={(next) => {
            setLocation(next);
            if (next) {
              setLocationError(null);
            }
          }}
          onCityPicked={({ name, countryCode }) => {
            if (!getValues('addressCity')) {
              setValue('addressCity', name);
            }
            if (!getValues('addressCountryCode')) {
              setValue('addressCountryCode', countryCode);
            }
          }}
          cityLabel={t('cityLabel')}
          useMyLocationLabel={t('useMyLocationCta')}
          useMyLocationErrorLabel={t('useMyLocationError')}
          locationSetLabel={t('locationSet')}
          requiredError={locationError ?? undefined}
        />
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('addressHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('addressHint')}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="request-address-line1">{t('addressLine1Label')}</Label>
          <Input
            id="request-address-line1"
            aria-invalid={Boolean(errors.addressLine1)}
            {...register('addressLine1')}
          />
          <FieldError
            id="request-address-line1-error"
            message={fieldErrorMessage(tValidation, errors.addressLine1)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="request-address-line2">{t('addressLine2Label')}</Label>
          <Input id="request-address-line2" {...register('addressLine2')} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-address-city">{t('addressCityLabel')}</Label>
            <Input
              id="request-address-city"
              aria-invalid={Boolean(errors.addressCity)}
              {...register('addressCity')}
            />
            <FieldError
              id="request-address-city-error"
              message={fieldErrorMessage(tValidation, errors.addressCity)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-address-postal-code">{t('addressPostalCodeLabel')}</Label>
            <Input
              id="request-address-postal-code"
              aria-invalid={Boolean(errors.addressPostalCode)}
              {...register('addressPostalCode')}
            />
            <FieldError
              id="request-address-postal-code-error"
              message={fieldErrorMessage(tValidation, errors.addressPostalCode)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="request-address-country">{t('addressCountryLabel')}</Label>
          <select
            id="request-address-country"
            aria-invalid={Boolean(errors.addressCountryCode)}
            className={SELECT_CLASSNAME}
            {...register('addressCountryCode')}
          >
            <option value="">{t('addressCountryPlaceholder')}</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
          <FieldError
            id="request-address-country-error"
            message={fieldErrorMessage(tValidation, errors.addressCountryCode)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('budgetHeading')}</h2>
        <p className="text-sm text-muted-foreground">
          {currency ?? (
            <a href="#request-address-country" className="underline underline-offset-4">
              {t('budgetCurrencyHint')}
            </a>
          )}
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-budget-min">{t('budgetMinLabel')}</Label>
            <Input
              id="request-budget-min"
              type="number"
              min={0}
              step="1"
              inputMode="numeric"
              aria-invalid={Boolean(errors.budgetMin)}
              {...register('budgetMin')}
            />
            <FieldError
              id="request-budget-min-error"
              message={
                errors.budgetMin?.message ?? fieldErrorMessage(tValidation, errors.budgetMin)
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="request-budget-max">{t('budgetMaxLabel')}</Label>
            <Input
              id="request-budget-max"
              type="number"
              min={0}
              step="1"
              inputMode="numeric"
              aria-invalid={Boolean(errors.budgetMax)}
              {...register('budgetMax')}
            />
            <FieldError
              id="request-budget-max-error"
              message={
                errors.budgetMax?.message ?? fieldErrorMessage(tValidation, errors.budgetMax)
              }
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="request-usage">{t('usageLabel')}</Label>
        <select
          id="request-usage"
          aria-invalid={Boolean(errors.usage)}
          className={SELECT_CLASSNAME}
          {...register('usage')}
        >
          <option value="">{t('usagePlaceholder')}</option>
          {LICENCE_USAGES.map((usage) => (
            <option key={usage} value={usage}>
              {tLicenceUsages(usage)}
            </option>
          ))}
        </select>
        <FieldError
          id="request-usage-error"
          message={fieldErrorMessage(tValidation, errors.usage)}
        />
      </div>

      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
