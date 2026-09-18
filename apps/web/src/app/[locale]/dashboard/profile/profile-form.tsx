'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';

import type { components } from '@photoo/api-client';
import {
  CreatePhotographerProfileRequestSchema,
  PHOTOGRAPHER_CATEGORIES,
  SUPPORTED_LOCALES,
  UpdatePhotographerProfileRequestSchema,
  slugify,
  type Locale,
} from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fieldErrorMessage } from '@/lib/form-errors';
import { requestErrorMessage } from '@/lib/request-errors';

import { LocationPicker, type PickedLocation } from '../../requests/new/location-picker';
import {
  buildProfilePayload,
  defaultValuesFromProfile,
  EMPTY_PROFILE_FORM_VALUES,
  mapProfileIssuePath,
  mapValidationErrorDetailPath,
  unsupportedLanguages,
  type ProfileFormValues,
} from './profile-form-helpers';

type OwnPhotographerProfile = components['schemas']['OwnPhotographerProfile'];
type CountrySummary = components['schemas']['CountrySummary'];

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export function ProfileForm({
  locale,
  existing,
  countries,
}: {
  locale: Locale;
  existing: OwnPhotographerProfile | null;
  countries: CountrySummary[];
}) {
  const t = useTranslations('web.dashboard.profile');
  const tCategories = useTranslations('common.categories');
  const tLocale = useTranslations('locale');
  const tValidation = useTranslations('common.validation');
  const router = useRouter();

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    setError,
    clearErrors,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ProfileFormValues>({
    defaultValues: existing ? defaultValuesFromProfile(existing) : EMPTY_PROFILE_FORM_VALUES,
  });

  const keptUnsupportedLanguages = useMemo(
    () => unsupportedLanguages(existing?.languages ?? []),
    [existing],
  );

  const [location, setLocation] = useState<PickedLocation | null>(existing?.location ?? null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const displayName = watch('displayName');
  const slugPreview = useMemo(() => (displayName ? slugify(displayName) : ''), [displayName]);

  async function onSubmit(values: ProfileFormValues) {
    setSubmitError(null);
    setLocationError(null);
    setSuccessMessage(null);
    clearErrors();

    if (!location) {
      setLocationError(t('locationRequired'));
      return;
    }

    const payload = buildProfilePayload(values, location, keptUnsupportedLanguages);

    function reportInvalid(issues: { path: readonly PropertyKey[]; code: string }[]): void {
      let hasFieldError = false;
      for (const issue of issues) {
        const field = mapProfileIssuePath(issue.path);
        if (field) {
          setError(field, { type: issue.code });
          hasFieldError = true;
        }
      }
      if (!hasFieldError) {
        setSubmitError(t('errors.invalid'));
      }
    }

    // Validates with the real contract schema, but sends `payload` itself
    // rather than `result.data`: zod's `.optional()` fields infer as
    // `T | undefined`, which `exactOptionalPropertyTypes` rejects against
    // the API's plain optional `T` once assigned - `payload` never carries
    // those fields at all, so it has no such type to reject.
    const schema = existing
      ? UpdatePhotographerProfileRequestSchema
      : CreatePhotographerProfileRequestSchema;
    const result = schema.safeParse(payload);
    if (!result.success) {
      reportInvalid(result.error.issues);
      return;
    }

    const { error } = existing
      ? await api.PATCH('/v1/me/photographer-profile', { body: payload })
      : await api.POST('/v1/me/photographer-profile', { body: payload });

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
          setSubmitError(requestErrorMessage(t, error));
        }
        return;
      }
      setSubmitError(requestErrorMessage(t, error));
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

      {existing ? (
        <Link
          href={`/${locale}/photographers/${existing.slug}`}
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('viewPublicProfileCta')}
        </Link>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            {t('slugPreviewLabel')}:{' '}
            <span className="font-mono">
              /{locale}/photographers/{slugPreview || '…'}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">{t('slugPreviewHint')}</p>
          {/* 'photographer' is slugify()'s own fallback (packages/shared/src/slug.ts)
              for a display name with too few latin letters/digits to build a slug from. */}
          {displayName && slugPreview === 'photographer' ? (
            <p className="text-sm text-muted-foreground">{t('slugFallbackHint')}</p>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profile-display-name">{t('displayNameLabel')}</Label>
        <Input
          id="profile-display-name"
          aria-invalid={Boolean(errors.displayName)}
          {...register('displayName')}
        />
        <FieldError
          id="profile-display-name-error"
          message={fieldErrorMessage(tValidation, errors.displayName)}
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">{t('categoriesHeading')}</legend>
        <p className="text-sm text-muted-foreground">{t('categoriesHint')}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {PHOTOGRAPHER_CATEGORIES.map((category) => (
            <label key={category} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                value={category}
                className="size-4"
                {...register('categories')}
              />
              {tCategories(category)}
            </label>
          ))}
        </div>
        <FieldError
          id="profile-categories-error"
          message={fieldErrorMessage(tValidation, errors.categories)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">{t('languagesHeading')}</legend>
        <p className="text-sm text-muted-foreground">{t('languagesHint')}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {SUPPORTED_LOCALES.map((language) => (
            <label key={language} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                value={language}
                className="size-4"
                {...register('languages')}
              />
              {tLocale(language)}
            </label>
          ))}
        </div>
        <FieldError
          id="profile-languages-error"
          message={fieldErrorMessage(tValidation, errors.languages)}
        />
      </fieldset>

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('bioHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('bioHint')}</p>
        </div>
        {SUPPORTED_LOCALES.map((bioLocale) => (
          <div key={bioLocale} className="flex flex-col gap-1.5">
            <Label htmlFor={`profile-bio-${bioLocale}`}>
              {t('bioLabel', { language: tLocale(bioLocale) })}
            </Label>
            <Textarea id={`profile-bio-${bioLocale}`} {...register(`bio.${bioLocale}`)} />
          </div>
        ))}
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
            if (!getValues('city')) {
              setValue('city', name);
            }
            if (!getValues('countryCode')) {
              setValue('countryCode', countryCode);
            }
          }}
          cityLabel={t('cityLabel')}
          useMyLocationLabel={t('useMyLocationCta')}
          useMyLocationErrorLabel={t('useMyLocationError')}
          locationSetLabel={t('locationSet')}
          requiredError={locationError ?? undefined}
        />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-city">{t('cityLabel')}</Label>
          <Input id="profile-city" aria-invalid={Boolean(errors.city)} {...register('city')} />
          <FieldError
            id="profile-city-error"
            message={fieldErrorMessage(tValidation, errors.city)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-country">{t('countryLabel')}</Label>
          <select
            id="profile-country"
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
            id="profile-country-error"
            message={fieldErrorMessage(tValidation, errors.countryCode)}
          />
        </div>
      </div>

      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? t('saving') : t(existing ? 'saveCta' : 'createCta')}
      </Button>
    </form>
  );
}
