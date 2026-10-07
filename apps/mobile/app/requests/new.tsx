import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import {
  CreateRequestRequestSchema,
  LICENCE_USAGES,
  PHOTOGRAPHER_CATEGORIES,
  SlugSchema,
  resolveLocale,
} from '@photoo/shared';

import { CityAutocomplete } from '../../src/components/discovery/city-autocomplete';
import { NearMeButton } from '../../src/components/discovery/near-me-button';
import { DateTimeField } from '../../src/components/form/date-time-field';
import { FormNotice } from '../../src/components/form/form-notice';
import { OptionPicker } from '../../src/components/form/option-picker';
import { PrimaryButton } from '../../src/components/form/primary-button';
import { TextField } from '../../src/components/form/text-field';
import { RequireSession } from '../../src/components/require-session';
import { api } from '../../src/lib/api';
import { roundCoordinate, type Coordinates } from '../../src/lib/location';
import {
  EMPTY_REQUEST_FORM_VALUES,
  buildCreateRequestPayload,
  mapRequestIssues,
  mapServerFieldErrors,
  type RequestFormErrors,
  type RequestFormField,
  type RequestFormValues,
} from '../../src/lib/request-form';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedRequestTranslate,
} from '../../src/lib/request-errors';

type CitySummary = components['schemas']['CitySummary'];
type CountrySummary = components['schemas']['CountrySummary'];
type LocationSource = 'city' | 'device';

function NewRequestForm() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { photographer } = useLocalSearchParams<{ photographer?: string }>();
  const fromPhotographer = SlugSchema.safeParse(photographer).success;
  const locale = resolveLocale(i18n.language);

  const [values, setValues] = useState<RequestFormValues>(EMPTY_REQUEST_FORM_VALUES);
  const inFlight = useRef(false);
  const [location, setLocation] = useState<Coordinates | null>(null);
  const [locationSource, setLocationSource] = useState<LocationSource | null>(null);
  const [cityText, setCityText] = useState('');
  const [countries, setCountries] = useState<CountrySummary[]>([]);
  const [countriesFailed, setCountriesFailed] = useState(false);
  const [errors, setErrors] = useState<RequestFormErrors>({});
  const [locationError, setLocationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
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

  const currency = countries.find((c) => c.code === values.addressCountryCode)?.currency ?? null;

  function setField<K extends RequestFormField>(field: K, value: RequestFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function handleCityText(text: string) {
    setCityText(text);
    if (locationSource === 'city') {
      setLocation(null);
      setLocationSource(null);
    }
  }

  function handleSelectCity(city: CitySummary) {
    setCityText(city.name);
    setLocation({
      lat: roundCoordinate(city.location.lat),
      lng: roundCoordinate(city.location.lng),
    });
    setLocationSource('city');
    setLocationError(null);
    setValues((current) => ({
      ...current,
      addressCity: current.addressCity || city.name,
      addressCountryCode: current.addressCountryCode || city.countryCode,
    }));
  }

  function handleDeviceLocation(coordinates: Coordinates) {
    setLocation(coordinates);
    setLocationSource('device');
    setLocationError(null);
  }

  async function handleSubmit() {
    if (inFlight.current) {
      return;
    }
    setSubmitError(null);
    setLocationError(null);

    const payload = buildCreateRequestPayload(values, location, currency);
    const parsed = CreateRequestRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const { fields, locationInvalid } = mapRequestIssues(parsed.error, {
        validation: (key) => t(`common.validation.${key}`),
        budgetOrder: t('mobile.requests.form.budgetMinGreaterThanMax'),
        eventDateInPast: t('mobile.requests.form.eventDateInPast'),
      });
      setErrors(fields);
      if (locationInvalid) {
        setLocationError(t('mobile.requests.form.locationRequired'));
      }
      return;
    }

    setErrors({});
    inFlight.current = true;
    setIsSubmitting(true);
    try {
      const { error, response } = await api.POST('/v1/requests', {
        body: { ...parsed.data, address: payload.address },
      });
      if (error) {
        const apiError = apiErrorWithStatus(error, response.status);
        const fields =
          apiError.code === 'VALIDATION_ERROR' ? mapServerFieldErrors(apiError.details) : [];
        if (fields.length > 0) {
          setErrors(
            Object.fromEntries(fields.map((field) => [field, t('common.validation.invalid')])),
          );
        }
        setSubmitError(requestErrorMessage(scopedRequestTranslate(t), apiError));
        return;
      }
      router.dismissTo('/requests');
    } catch {
      setSubmitError(t('mobile.requests.form.submitFailed'));
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  }

  const countryOptions = countries.map((country) => ({ value: country.code, label: country.name }));

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerClassName="gap-5 px-6 py-12"
        keyboardShouldPersistTaps="handled"
        testID="new-request-form"
      >
        <View className="gap-2">
          <Text className="text-2xl font-semibold text-foreground">
            {t('mobile.requests.new.title')}
          </Text>
          <Text className="text-muted-foreground">{t('mobile.requests.new.intro')}</Text>
          {fromPhotographer ? (
            <FormNotice tone="info" testID="new-request-photographer-notice">
              {t('mobile.requests.new.photographerIntro')}
            </FormNotice>
          ) : null}
        </View>

        {submitError ? (
          <FormNotice tone="error" testID="new-request-error">
            {submitError}
          </FormNotice>
        ) : null}

        <TextField
          testID="request-title"
          label={t('mobile.requests.form.titleLabel')}
          value={values.title}
          onChangeText={(text) => {
            setField('title', text);
          }}
          error={errors.title}
        />
        <OptionPicker
          testID="request-category"
          label={t('mobile.requests.form.categoryLabel')}
          options={PHOTOGRAPHER_CATEGORIES.map((category) => ({
            value: category,
            label: t(`common.categories.${category}`),
          }))}
          value={values.category}
          onChange={(value) => {
            setField('category', value as RequestFormValues['category']);
          }}
          error={errors.category}
        />
        <TextField
          testID="request-description"
          label={t('mobile.requests.form.descriptionLabel')}
          value={values.description}
          onChangeText={(text) => {
            setField('description', text);
          }}
          multiline
          textAlignVertical="top"
          error={errors.description}
        />
        <DateTimeField
          testID="request-event-date"
          label={t('mobile.requests.form.eventDateLabel')}
          placeholder={t('mobile.requests.form.eventDatePlaceholder')}
          value={values.eventDate}
          minimumDate={new Date()}
          locale={locale}
          onChange={(date) => {
            setField('eventDate', date);
          }}
          error={errors.eventDate}
        />
        <Pressable
          testID="request-date-flexible"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: values.dateFlexible }}
          onPress={() => {
            setField('dateFlexible', !values.dateFlexible);
          }}
          className="min-h-11 flex-row items-center gap-2"
        >
          <View
            className={`h-5 w-5 rounded border ${values.dateFlexible ? 'border-primary bg-primary' : 'border-input bg-background'}`}
          />
          <Text className="text-sm text-foreground">
            {t('mobile.requests.form.dateFlexibleLabel')}
          </Text>
        </Pressable>

        <View className="gap-3">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.requests.form.locationHeading')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.requests.form.locationExplanation')}
          </Text>
          <CityAutocomplete
            value={cityText}
            onChangeText={handleCityText}
            onSelectCity={handleSelectCity}
          />
          <NearMeButton onLocated={handleDeviceLocation} />
          {location ? (
            <Text className="text-sm text-muted-foreground" testID="request-location-set">
              {t('mobile.requests.form.locationSet')}
            </Text>
          ) : null}
          {locationError ? (
            <Text className="text-sm text-destructive" testID="request-location-error">
              {locationError}
            </Text>
          ) : null}
        </View>

        <View className="gap-3">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.requests.form.addressHeading')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.requests.form.addressHint')}
          </Text>
          <TextField
            testID="request-address-line1"
            label={t('mobile.requests.form.addressLine1Label')}
            value={values.addressLine1}
            onChangeText={(text) => {
              setField('addressLine1', text);
            }}
            autoComplete="address-line1"
            error={errors.addressLine1}
          />
          <TextField
            testID="request-address-line2"
            label={t('mobile.requests.form.addressLine2Label')}
            value={values.addressLine2}
            onChangeText={(text) => {
              setField('addressLine2', text);
            }}
            autoComplete="address-line2"
            error={errors.addressLine2}
          />
          <TextField
            testID="request-address-city"
            label={t('mobile.requests.form.addressCityLabel')}
            value={values.addressCity}
            onChangeText={(text) => {
              setField('addressCity', text);
            }}
            error={errors.addressCity}
          />
          <TextField
            testID="request-address-postal-code"
            label={t('mobile.requests.form.addressPostalCodeLabel')}
            value={values.addressPostalCode}
            onChangeText={(text) => {
              setField('addressPostalCode', text);
            }}
            autoComplete="postal-code"
            error={errors.addressPostalCode}
          />
          <OptionPicker
            testID="request-address-country"
            label={t('mobile.requests.form.addressCountryLabel')}
            options={countryOptions}
            value={values.addressCountryCode}
            onChange={(value) => {
              setField('addressCountryCode', value);
            }}
            error={errors.addressCountryCode}
          />
          {countriesFailed ? (
            <View className="gap-1" testID="request-countries-error" accessibilityRole="alert">
              <Text className="text-sm text-destructive">
                {t('mobile.requests.new.countriesError')}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadCountries()}
                testID="request-countries-retry"
                className="min-h-11 justify-center"
              >
                <Text className="text-sm font-medium text-foreground underline">
                  {t('mobile.requests.new.countriesRetry')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View className="gap-3">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.requests.form.budgetHeading')}
          </Text>
          <Text className="text-sm text-muted-foreground" testID="request-currency">
            {currency ?? t('mobile.requests.form.budgetCurrencyHint')}
          </Text>
          <TextField
            testID="request-budget-min"
            label={t('mobile.requests.form.budgetMinLabel')}
            value={values.budgetMin}
            onChangeText={(text) => {
              setField('budgetMin', text);
            }}
            keyboardType="number-pad"
            error={errors.budgetMin}
          />
          <TextField
            testID="request-budget-max"
            label={t('mobile.requests.form.budgetMaxLabel')}
            value={values.budgetMax}
            onChangeText={(text) => {
              setField('budgetMax', text);
            }}
            keyboardType="number-pad"
            error={errors.budgetMax}
          />
        </View>

        <OptionPicker
          testID="request-usage"
          label={t('mobile.requests.form.usageLabel')}
          options={LICENCE_USAGES.map((usage) => ({
            value: usage,
            label: t(`common.licenceUsages.${usage}`),
          }))}
          value={values.usage}
          onChange={(value) => {
            setField('usage', value as RequestFormValues['usage']);
          }}
          error={errors.usage}
        />

        <PrimaryButton
          testID="request-submit"
          label={t(
            isSubmitting ? 'mobile.requests.form.submitting' : 'mobile.requests.form.submit',
          )}
          onPress={() => void handleSubmit()}
          loading={isSubmitting}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.back();
          }}
          testID="request-cancel"
          className="min-h-11 items-center justify-center"
        >
          <Text className="text-sm font-medium text-foreground underline">
            {t('mobile.requests.new.cancel')}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export default function NewRequestScreen() {
  return (
    <RequireSession>
      <NewRequestForm />
    </RequireSession>
  );
}
