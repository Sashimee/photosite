'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import type { components } from '@photoo/api-client';
import {
  CreateJobOfferRequestSchema,
  PHOTOGRAPHER_CATEGORIES,
  UpdateJobOfferRequestSchema,
} from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fieldErrorMessage } from '@/lib/form-errors';
import { requestErrorMessage } from '@/lib/request-errors';

import { CityAutocomplete } from '../../photographers/city-autocomplete';
import {
  buildJobOfferPayload,
  defaultValuesFromJobOffer,
  EMPTY_JOB_OFFER_FORM_VALUES,
  isJobOfferLocationMissing,
  isValidJobOfferDateRange,
  locationFromJobOffer,
  mapJobOfferIssuePath,
  mapValidationErrorDetailPath,
  type JobOfferFormValues,
  type JobOfferInput,
  type PickedLocation,
} from './job-offer-form-helpers';

type CountrySummary = components['schemas']['CountrySummary'];
type CitySuggestion = components['schemas']['CitySummary'];

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export function JobOfferForm({
  existing,
  countries,
}: {
  existing: JobOfferInput | null;
  countries: CountrySummary[];
}) {
  const t = useTranslations('web.jobOffers.form');
  const tCategories = useTranslations('common.categories');
  const tValidation = useTranslations('common.validation');
  const tErrors = useTranslations('web.jobOffers');
  const router = useRouter();

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    setError,
    clearErrors,
    control,
    formState: { errors, isSubmitting },
  } = useForm<JobOfferFormValues>({
    defaultValues: existing ? defaultValuesFromJobOffer(existing) : EMPTY_JOB_OFFER_FORM_VALUES,
  });

  const [location, setLocation] = useState<PickedLocation | null>(locationFromJobOffer(existing));
  // Tracks whether the current `location` came from picking a suggestion here
  // (in which case retyping/clearing that search box should drop it again) or
  // from the existing offer on load (in which case it must survive the
  // autocomplete's own mount-time "no query yet" callback untouched) - same
  // reasoning as `location-picker.tsx`'s `source` state.
  const [locationSource, setLocationSource] = useState<'city' | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const remote = useWatch({ control, name: 'remote' });
  const countryCode = useWatch({ control, name: 'countryCode' });
  const currency = countries.find((country) => country.code === countryCode)?.currency ?? '';

  function handleCitySelect(city: CitySuggestion | null) {
    if (!city) {
      if (locationSource === 'city') {
        setLocationSource(null);
        setLocation(null);
      }
      return;
    }
    setLocationSource('city');
    setLocation(city.location);
    setLocationError(null);
    if (!getValues('city')) {
      setValue('city', city.name);
    }
    if (!getValues('countryCode')) {
      setValue('countryCode', city.countryCode);
    }
  }

  async function onSubmit(values: JobOfferFormValues) {
    setSubmitError(null);
    setLocationError(null);
    setSuccessMessage(null);
    clearErrors();

    if (!isValidJobOfferDateRange(values.startDate, values.endDate)) {
      setError('endDate', { type: 'custom' });
      setSubmitError(t('dateRangeInvalid'));
      return;
    }
    if (isJobOfferLocationMissing(values.remote, location)) {
      setLocationError(t('locationRequired'));
      return;
    }

    const payload = buildJobOfferPayload(values, values.remote ? null : location, currency);

    function reportInvalid(issues: { path: readonly PropertyKey[]; code: string }[]): void {
      let hasFieldError = false;
      for (const issue of issues) {
        const field = mapJobOfferIssuePath(issue.path);
        if (field) {
          setError(field, { type: issue.code });
          hasFieldError = true;
        }
      }
      if (!hasFieldError) {
        setSubmitError(tErrors('errors.invalid'));
      }
    }

    const schema = existing ? UpdateJobOfferRequestSchema : CreateJobOfferRequestSchema;
    const result = schema.safeParse(payload);
    if (!result.success) {
      reportInvalid(result.error.issues);
      return;
    }

    const { error } = existing
      ? await api.PATCH('/v1/me/job-offers/{id}', {
          params: { path: { id: existing.id } },
          body: payload,
        })
      : await api.POST('/v1/me/job-offers', { body: payload });

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
          setSubmitError(tErrors('errors.invalid'));
        }
        return;
      }
      setSubmitError(requestErrorMessage(tErrors, error));
      return;
    }

    setSuccessMessage(existing ? t('saved') : t('created'));
    router.refresh();
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      className="flex flex-col gap-8"
    >
      {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
      {successMessage ? <FormNotice tone="success">{successMessage}</FormNotice> : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="job-offer-title">{t('titleLabel')}</Label>
        <Input id="job-offer-title" aria-invalid={Boolean(errors.title)} {...register('title')} />
        <FieldError
          id="job-offer-title-error"
          message={fieldErrorMessage(tValidation, errors.title)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="job-offer-description">{t('descriptionLabel')}</Label>
        <Textarea
          id="job-offer-description"
          aria-invalid={Boolean(errors.description)}
          {...register('description')}
        />
        <FieldError
          id="job-offer-description-error"
          message={fieldErrorMessage(tValidation, errors.description)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="job-offer-category">{t('categoryLabel')}</Label>
        <select
          id="job-offer-category"
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
          id="job-offer-category-error"
          message={fieldErrorMessage(tValidation, errors.category)}
        />
      </div>

      <label className="flex items-center gap-3 text-sm text-foreground">
        <Switch {...register('remote')} />
        {t('remoteLabel')}
      </label>
      <p className="-mt-6 text-sm text-muted-foreground">{t('remoteHint')}</p>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t('citySearchHint')}</p>
        <CityAutocomplete
          label={t('citySearchLabel')}
          name="job-offer-city-search"
          countryCode={countryCode || undefined}
          onCitySelect={handleCitySelect}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="job-offer-city">{t('cityLabel')}</Label>
          <Input id="job-offer-city" aria-invalid={Boolean(errors.city)} {...register('city')} />
          <FieldError
            id="job-offer-city-error"
            message={fieldErrorMessage(tValidation, errors.city)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="job-offer-country">{t('countryLabel')}</Label>
          <select
            id="job-offer-country"
            aria-invalid={Boolean(errors.countryCode)}
            className={SELECT_CLASSNAME}
            {...register('countryCode')}
          >
            <option value="">{t('countryPlaceholder')}</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
          <FieldError
            id="job-offer-country-error"
            message={fieldErrorMessage(tValidation, errors.countryCode)}
          />
        </div>

        {remote ? null : (
          <>
            {location ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t('locationSet')}
              </p>
            ) : null}
            <FieldError id="job-offer-location-error" message={locationError ?? undefined} />
          </>
        )}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="job-offer-start-date">{t('startDateLabel')}</Label>
          <Input
            id="job-offer-start-date"
            type="date"
            aria-invalid={Boolean(errors.startDate)}
            {...register('startDate')}
          />
          <FieldError
            id="job-offer-start-date-error"
            message={fieldErrorMessage(tValidation, errors.startDate)}
          />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="job-offer-end-date">{t('endDateLabel')}</Label>
          <Input
            id="job-offer-end-date"
            type="date"
            aria-invalid={Boolean(errors.endDate)}
            {...register('endDate')}
          />
          <FieldError
            id="job-offer-end-date-error"
            message={fieldErrorMessage(tValidation, errors.endDate)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('compensationHeading')}</h2>
          <p className="text-sm text-muted-foreground">
            {currency ? t('compensationHint', { currency }) : null}
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="job-offer-compensation-min">{t('compensationMinLabel')}</Label>
            <Input
              id="job-offer-compensation-min"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              aria-invalid={Boolean(errors.compensationMin)}
              {...register('compensationMin')}
            />
            <FieldError
              id="job-offer-compensation-min-error"
              message={fieldErrorMessage(tValidation, errors.compensationMin)}
            />
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label htmlFor="job-offer-compensation-max">{t('compensationMaxLabel')}</Label>
            <Input
              id="job-offer-compensation-max"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              aria-invalid={Boolean(errors.compensationMax)}
              {...register('compensationMax')}
            />
            <FieldError
              id="job-offer-compensation-max-error"
              message={fieldErrorMessage(tValidation, errors.compensationMax)}
            />
          </div>
        </div>
      </div>

      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? t('saving') : t(existing ? 'saveCta' : 'createCta')}
      </Button>
    </form>
  );
}
