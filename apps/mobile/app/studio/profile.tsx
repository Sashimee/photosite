import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import {
  CreatePhotographerProfileRequestSchema,
  PHOTOGRAPHER_CATEGORIES,
  SUPPORTED_LOCALES,
  UpdatePhotographerProfileRequestSchema,
  type Locale,
  type PhotographerCategory,
} from '@photoo/shared';

import { CityAutocomplete } from '../../src/components/discovery/city-autocomplete';
import { NearMeButton } from '../../src/components/discovery/near-me-button';
import { FormNotice } from '../../src/components/form/form-notice';
import { MultiOptionPicker } from '../../src/components/form/multi-option-picker';
import { OptionPicker } from '../../src/components/form/option-picker';
import { PrimaryButton } from '../../src/components/form/primary-button';
import { TextField } from '../../src/components/form/text-field';
import {
  StudioFrame,
  StudioLoading,
  StudioMessage,
} from '../../src/components/studio/studio-frame';
import { api } from '../../src/lib/api';
import { fieldErrorMessages } from '../../src/lib/form-errors';
import { roundCoordinate, type Coordinates } from '../../src/lib/location';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedStudioTranslate,
} from '../../src/lib/request-errors';
import {
  buildProfilePayload,
  mapProfileIssuePath,
  mapServerFieldErrors,
  toggleValue,
  unsupportedLanguages,
  valuesFromProfile,
  type StudioProfileErrors,
  type StudioProfileField,
  type StudioProfileValues,
} from '../../src/lib/studio-profile-form';
import { useOwnPhotographerProfile } from '../../src/lib/use-own-photographer-profile';

type OwnPhotographerProfile = components['schemas']['OwnPhotographerProfile'];
type CitySummary = components['schemas']['CitySummary'];
type CountrySummary = components['schemas']['CountrySummary'];

function ProfileForm({
  existing,
  onSaved,
}: {
  existing: OwnPhotographerProfile | null;
  onSaved: (profile: OwnPhotographerProfile) => void;
}) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const kept = useMemo(() => unsupportedLanguages(existing?.languages ?? []), [existing]);

  const [values, setValues] = useState<StudioProfileValues>(() => valuesFromProfile(existing));
  const [location, setLocation] = useState<Coordinates | null>(existing?.location ?? null);
  const [cityText, setCityText] = useState(existing?.city ?? '');
  const [countries, setCountries] = useState<CountrySummary[]>([]);
  const [countriesFailed, setCountriesFailed] = useState(false);
  const [errors, setErrors] = useState<StudioProfileErrors>({});
  const [locationError, setLocationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savedKind, setSavedKind] = useState<'created' | 'saved' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadCountries = useCallback(async () => {
    setCountriesFailed(false);
    const data = await api
      .GET('/v1/countries')
      .then((result) => result.data)
      .catch(() => undefined);
    if (data) {
      setCountries(data);
    } else {
      setCountriesFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadCountries();
  }, [loadCountries]);

  function setField<K extends keyof StudioProfileValues>(field: K, value: StudioProfileValues[K]) {
    setSavedKind(null);
    setValues((current) => ({ ...current, [field]: value }));
    if (field !== 'bio') {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function handleSelectCity(city: CitySummary) {
    setCityText(city.name);
    setLocation({
      lat: roundCoordinate(city.location.lat),
      lng: roundCoordinate(city.location.lng),
    });
    setLocationError(null);
    setValues((current) => ({
      ...current,
      city: current.city || city.name,
      countryCode: current.countryCode || city.countryCode,
    }));
  }

  async function handleSubmit() {
    if (inFlight.current) {
      return;
    }
    setSubmitError(null);
    setSavedKind(null);
    setLocationError(null);

    if (!location) {
      setLocationError(t('mobile.studio.profile.locationRequired'));
      return;
    }

    const payload = buildProfilePayload(values, location, kept);
    const schema = existing
      ? UpdatePhotographerProfileRequestSchema
      : CreatePhotographerProfileRequestSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const messages = fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error);
      const next: StudioProfileErrors = {};
      for (const issue of parsed.error.issues) {
        const field = mapProfileIssuePath(issue.path);
        const message = messages[issue.path.join('.')];
        if (field && message) {
          next[field] = message;
        }
      }
      setErrors(next);
      if (Object.keys(next).length === 0) {
        setSubmitError(t('mobile.studio.profile.errors.invalid'));
      }
      return;
    }

    setErrors({});
    inFlight.current = true;
    setIsSubmitting(true);
    try {
      const result = existing
        ? await api.PATCH('/v1/me/photographer-profile', { body: payload })
        : await api.POST('/v1/me/photographer-profile', { body: payload });
      if (result.error) {
        const apiError = apiErrorWithStatus(result.error, result.response.status);
        const fields =
          apiError.code === 'VALIDATION_ERROR' ? mapServerFieldErrors(apiError.details) : [];
        if (fields.length > 0) {
          setErrors(
            Object.fromEntries(fields.map((field) => [field, t('common.validation.invalid')])),
          );
        }
        setSubmitError(requestErrorMessage(scopedStudioTranslate(t, 'profile'), apiError));
        return;
      }
      setSavedKind(existing ? 'saved' : 'created');
      onSaved(result.data);
    } catch {
      setSubmitError(t('mobile.studio.profile.errors.generic'));
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  }

  const fieldError = (field: StudioProfileField) => errors[field];

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerClassName="gap-5 px-6 pb-12"
        keyboardShouldPersistTaps="handled"
        testID="studio-profile-form"
      >
        {existing ? null : (
          <View className="gap-2">
            <Text className="text-muted-foreground">{t('mobile.studio.profile.createIntro')}</Text>
            <Text className="text-sm text-muted-foreground">
              {t('mobile.studio.profile.slugHint')}
            </Text>
          </View>
        )}
        {existing ? (
          <View className="flex-row flex-wrap gap-2" testID="studio-profile-status">
            <Text className="text-sm text-muted-foreground">
              {t(`mobile.studio.profile.verification.${existing.verificationStatus}`)}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {t(
                existing.isPublished
                  ? 'mobile.studio.profile.published'
                  : 'mobile.studio.profile.unpublished',
              )}
            </Text>
          </View>
        ) : null}
        {submitError ? (
          <FormNotice tone="error" testID="studio-profile-error">
            {submitError}
          </FormNotice>
        ) : null}
        {savedKind ? (
          <FormNotice tone="success" testID="studio-profile-saved">
            {t(`mobile.studio.profile.${savedKind}`)}
          </FormNotice>
        ) : null}

        <TextField
          testID="studio-profile-display-name"
          label={t('mobile.studio.profile.displayNameLabel')}
          value={values.displayName}
          onChangeText={(text) => {
            setField('displayName', text);
          }}
          error={fieldError('displayName')}
        />
        <MultiOptionPicker
          testID="studio-profile-categories"
          label={t('mobile.studio.profile.categoriesHeading')}
          hint={t('mobile.studio.profile.categoriesHint')}
          options={PHOTOGRAPHER_CATEGORIES.map((category) => ({
            value: category,
            label: t(`common.categories.${category}`),
          }))}
          values={values.categories}
          onToggle={(value) => {
            setField('categories', toggleValue(values.categories, value as PhotographerCategory));
          }}
          error={fieldError('categories')}
        />
        <MultiOptionPicker
          testID="studio-profile-languages"
          label={t('mobile.studio.profile.languagesHeading')}
          hint={t('mobile.studio.profile.languagesHint')}
          options={SUPPORTED_LOCALES.map((locale) => ({
            value: locale,
            label: t(`locale.${locale}`),
          }))}
          values={values.languages}
          onToggle={(value) => {
            setField('languages', toggleValue(values.languages, value as Locale));
          }}
          error={fieldError('languages')}
        />

        <View className="gap-3">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.studio.profile.bioHeading')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.studio.profile.bioHint')}
          </Text>
          {SUPPORTED_LOCALES.map((locale) => (
            <TextField
              key={locale}
              testID={`studio-profile-bio-${locale}`}
              label={t('mobile.studio.profile.bioLabel', { language: t(`locale.${locale}`) })}
              value={values.bio[locale]}
              onChangeText={(text) => {
                setField('bio', { ...values.bio, [locale]: text });
              }}
              multiline
              textAlignVertical="top"
            />
          ))}
        </View>

        <View className="gap-3">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.studio.profile.locationHeading')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.studio.profile.locationExplanation')}
          </Text>
          <CityAutocomplete
            value={cityText}
            onChangeText={(text) => {
              setCityText(text);
              setLocation(null);
            }}
            onSelectCity={handleSelectCity}
          />
          <NearMeButton
            onLocated={(coordinates) => {
              setLocation(coordinates);
              setLocationError(null);
            }}
          />
          {location ? (
            <Text className="text-sm text-muted-foreground" testID="studio-profile-location-set">
              {t('mobile.studio.profile.locationSet')}
            </Text>
          ) : null}
          {locationError ? (
            <Text className="text-sm text-destructive" testID="studio-profile-location-error">
              {locationError}
            </Text>
          ) : null}
          <TextField
            testID="studio-profile-city"
            label={t('mobile.studio.profile.cityLabel')}
            value={values.city}
            onChangeText={(text) => {
              setField('city', text);
            }}
            error={fieldError('city')}
          />
          <OptionPicker
            testID="studio-profile-country"
            label={t('mobile.studio.profile.countryLabel')}
            options={countries.map((country) => ({ value: country.code, label: country.name }))}
            value={values.countryCode}
            onChange={(value) => {
              setField('countryCode', value);
            }}
            error={fieldError('countryCode')}
          />
          {countriesFailed ? (
            <View
              className="gap-1"
              testID="studio-profile-countries-error"
              accessibilityRole="alert"
            >
              <Text className="text-sm text-destructive">
                {t('mobile.studio.profile.countriesError')}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadCountries()}
                testID="studio-profile-countries-retry"
                className="min-h-11 justify-center"
              >
                <Text className="text-sm font-medium text-foreground underline">
                  {t('mobile.studio.retry')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <PrimaryButton
          testID="studio-profile-submit"
          label={t(
            isSubmitting
              ? 'mobile.studio.profile.saving'
              : existing
                ? 'mobile.studio.profile.saveCta'
                : 'mobile.studio.profile.createCta',
          )}
          onPress={() => void handleSubmit()}
          loading={isSubmitting}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function StudioProfileScreen() {
  const { t } = useTranslation();
  const { state, reload, replace } = useOwnPhotographerProfile();
  const existing = state.status === 'ready' ? state.profile : null;

  return (
    <StudioFrame
      title={t(
        state.status === 'missing'
          ? 'mobile.studio.profile.createTitle'
          : 'mobile.studio.profile.title',
      )}
    >
      {state.status === 'loading' ? <StudioLoading testID="studio-profile-loading" /> : null}
      {state.status === 'unauthorized' ? (
        <StudioMessage
          testID="studio-profile-unauthorized"
          message={t('mobile.studio.sessionExpired')}
        />
      ) : null}
      {state.status === 'error' ? (
        <StudioMessage
          testID="studio-profile-load-error"
          message={t('mobile.studio.loadFailed')}
          actionLabel={t('mobile.studio.retry')}
          actionTestID="studio-profile-retry"
          onAction={reload}
        />
      ) : null}
      {state.status === 'ready' || state.status === 'missing' ? (
        <ProfileForm existing={existing} onSaved={replace} />
      ) : null}
    </StudioFrame>
  );
}
