import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import {
  CreateProductRequestSchema,
  LICENCE_USAGES,
  PHOTOGRAPHER_CATEGORIES,
  SUPPORTED_LOCALES,
  UpdateProductRequestSchema,
  type Locale,
} from '@photoo/shared';

import { api } from '../../lib/api';
import { fieldErrorMessages } from '../../lib/form-errors';
import {
  EMPTY_DELIVERABLE,
  EMPTY_TIER,
  buildProductPayload,
  defaultValuesFromProduct,
  hasDuplicateDeliverableKeys,
  hasDuplicateTierUsage,
  mapProductIssuePath,
  mapValidationErrorDetailPath,
  tierFieldPath,
  toAmountCents,
  type DeliverableRow,
  type DeliverableValueType,
  type ProductFieldPath,
  type ProductFormValues,
  type TierFormValue,
} from '../../lib/product-form';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedStudioTranslate,
} from '../../lib/request-errors';
import { FormNotice } from '../form/form-notice';
import { OptionPicker } from '../form/option-picker';
import { PrimaryButton } from '../form/primary-button';
import { TextField } from '../form/text-field';

type Product = components['schemas']['Product'];
type FieldErrors = Partial<Record<ProductFieldPath, string>>;

const MAX_TIERS = LICENCE_USAGES.length;
const DELIVERABLE_TYPES: readonly DeliverableValueType[] = ['text', 'number', 'boolean'];

function OutlineButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      className={`min-h-11 items-center justify-center self-start rounded-md border border-input px-4 py-2 ${disabled ? 'opacity-50' : ''}`}
    >
      <Text className="text-base font-medium text-foreground">{label}</Text>
    </Pressable>
  );
}

export function ProductForm({
  existing,
  currency,
  onDone,
  footer,
}: {
  existing: Product | null;
  currency: string;
  onDone: () => void;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const [values, setValues] = useState<ProductFormValues>(() => defaultValuesFromProduct(existing));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [titleError, setTitleError] = useState<string | null>(null);
  const [tiersError, setTiersError] = useState<string | null>(null);
  const [deliverablesError, setDeliverablesError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function patch(update: Partial<ProductFormValues>) {
    setValues((current) => ({ ...current, ...update }));
  }

  function clearError(field: ProductFieldPath) {
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function patchTier(index: number, update: Partial<TierFormValue>) {
    setValues((current) => ({
      ...current,
      tiers: current.tiers.map((tier, i) => (i === index ? { ...tier, ...update } : tier)),
    }));
  }

  function patchDeliverable(index: number, update: Partial<DeliverableRow>) {
    setValues((current) => ({
      ...current,
      deliverables: current.deliverables.map((row, i) =>
        i === index ? { ...row, ...update } : row,
      ),
    }));
  }

  function validateLocally(): FieldErrors | null {
    const next: FieldErrors = {};
    const priceMessage = t('mobile.studio.products.form.priceInvalid');
    if (Number.isNaN(toAmountCents(values.basePrice))) {
      next.basePrice = priceMessage;
    }
    values.tiers.forEach((tier, index) => {
      if (Number.isNaN(toAmountCents(tier.price))) {
        next[tierFieldPath(index, 'price')] = priceMessage;
      }
    });
    return Object.keys(next).length > 0 ? next : null;
  }

  async function handleSubmit() {
    if (inFlight.current) {
      return;
    }
    setErrors({});
    setTitleError(null);
    setTiersError(null);
    setDeliverablesError(null);
    setSubmitError(null);

    if (!SUPPORTED_LOCALES.some((locale) => values.title[locale].trim() !== '')) {
      setTitleError(t('mobile.studio.products.form.titleRequired'));
      return;
    }
    if (hasDuplicateTierUsage(values.tiers)) {
      setTiersError(t('mobile.studio.products.form.duplicateTierUsage'));
      return;
    }
    if (hasDuplicateDeliverableKeys(values.deliverables)) {
      setDeliverablesError(t('mobile.studio.products.form.duplicateDeliverableKey'));
      return;
    }
    const priceErrors = validateLocally();
    if (priceErrors) {
      setErrors(priceErrors);
      return;
    }

    const payload = buildProductPayload(values, currency);
    const schema = existing ? UpdateProductRequestSchema : CreateProductRequestSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const messages = fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error);
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = mapProductIssuePath(issue.path);
        const message = messages[issue.path.join('.')];
        if (field && message) {
          next[field] = message;
        }
      }
      setErrors(next);
      if (Object.keys(next).length === 0) {
        setSubmitError(t('mobile.studio.products.errors.invalid'));
      }
      return;
    }

    inFlight.current = true;
    setIsSubmitting(true);
    try {
      const result = existing
        ? await api.PATCH('/v1/me/products/{productId}', {
            params: { path: { productId: existing.id } },
            body: payload,
          })
        : await api.POST('/v1/me/products', { body: payload });
      if (result.error) {
        const apiError = apiErrorWithStatus(result.error, result.response.status);
        const next: FieldErrors = {};
        for (const field of mapValidationErrorDetailPath(apiError.details)) {
          if (field) {
            next[field] = t('common.validation.invalid');
          }
        }
        setErrors(next);
        setSubmitError(
          Object.keys(next).length > 0
            ? t('mobile.studio.products.errors.invalid')
            : requestErrorMessage(scopedStudioTranslate(t, 'products'), apiError),
        );
        return;
      }
      onDone();
    } catch {
      setSubmitError(t('mobile.studio.products.errors.generic'));
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  }

  const currencyHint = t('mobile.studio.products.form.currencyHint', { currency });

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerClassName="gap-5 px-6 pb-12"
        keyboardShouldPersistTaps="handled"
        testID="product-form"
      >
        {submitError ? (
          <FormNotice tone="error" testID="product-form-error">
            {submitError}
          </FormNotice>
        ) : null}

        <View className="gap-3">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.studio.products.form.titleHeading')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.studio.products.form.titleHint')}
          </Text>
          {SUPPORTED_LOCALES.map((locale: Locale) => (
            <TextField
              key={locale}
              testID={`product-title-${locale}`}
              label={t('mobile.studio.products.form.titleLabel', {
                language: t(`locale.${locale}`),
              })}
              value={values.title[locale]}
              onChangeText={(text) => {
                patch({ title: { ...values.title, [locale]: text } });
              }}
            />
          ))}
          {titleError ? (
            <Text className="text-sm text-destructive" testID="product-title-error">
              {titleError}
            </Text>
          ) : null}
        </View>

        <View className="gap-3">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.studio.products.form.descriptionHeading')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.studio.products.form.descriptionHint')}
          </Text>
          {SUPPORTED_LOCALES.map((locale: Locale) => (
            <TextField
              key={locale}
              testID={`product-description-${locale}`}
              label={t('mobile.studio.products.form.descriptionLabel', {
                language: t(`locale.${locale}`),
              })}
              value={values.description[locale]}
              onChangeText={(text) => {
                patch({ description: { ...values.description, [locale]: text } });
              }}
              multiline
              textAlignVertical="top"
            />
          ))}
        </View>

        <OptionPicker
          testID="product-category"
          label={t('mobile.studio.products.form.categoryLabel')}
          options={PHOTOGRAPHER_CATEGORIES.map((category) => ({
            value: category,
            label: t(`common.categories.${category}`),
          }))}
          value={values.category}
          onChange={(value) => {
            clearError('category');
            patch({ category: value as ProductFormValues['category'] });
          }}
          error={errors.category}
        />

        <TextField
          testID="product-duration"
          label={t('mobile.studio.products.form.durationMinutesLabel')}
          value={values.durationMinutes}
          onChangeText={(text) => {
            clearError('durationMinutes');
            patch({ durationMinutes: text });
          }}
          keyboardType="number-pad"
          error={errors.durationMinutes}
        />

        <TextField
          testID="product-base-price"
          label={t('mobile.studio.products.form.basePriceLabel')}
          hint={currencyHint}
          value={values.basePrice}
          onChangeText={(text) => {
            clearError('basePrice');
            patch({ basePrice: text });
          }}
          keyboardType="decimal-pad"
          error={errors.basePrice}
        />

        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: values.isActive }}
          onPress={() => {
            patch({ isActive: !values.isActive });
          }}
          testID="product-active"
          className="min-h-11 flex-row items-center gap-3"
        >
          <View
            className={`size-6 items-center justify-center rounded border ${values.isActive ? 'border-primary bg-primary' : 'border-input bg-background'}`}
          >
            {values.isActive ? <Text className="text-primary-foreground">✓</Text> : null}
          </View>
          <Text className="flex-1 text-base text-foreground">
            {t('mobile.studio.products.form.isActiveLabel')}
          </Text>
        </Pressable>

        <View className="gap-3">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.studio.products.form.deliverablesHeading')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.studio.products.form.deliverablesHint')}
          </Text>
          {deliverablesError ? (
            <FormNotice tone="error" testID="product-deliverables-error">
              {deliverablesError}
            </FormNotice>
          ) : null}
          {values.deliverables.map((row, index) => (
            <View
              key={index}
              className="gap-3 rounded-md border border-border p-3"
              testID={`product-deliverable-${String(index)}`}
            >
              <TextField
                testID={`product-deliverable-${String(index)}-key`}
                label={t('mobile.studio.products.form.deliverableKeyLabel')}
                placeholder={t('mobile.studio.products.form.deliverableKeyPlaceholder')}
                value={row.key}
                onChangeText={(text) => {
                  patchDeliverable(index, { key: text });
                }}
              />
              <OptionPicker
                testID={`product-deliverable-${String(index)}-type`}
                label={t('mobile.studio.products.form.deliverableTypeLabel')}
                options={DELIVERABLE_TYPES.map((type) => ({
                  value: type,
                  label: t(`mobile.studio.products.form.deliverableType.${type}`),
                }))}
                value={row.valueType}
                onChange={(value) => {
                  const valueType = value as DeliverableValueType;
                  patchDeliverable(index, {
                    valueType,
                    value: valueType === 'boolean' ? 'true' : '',
                  });
                }}
              />
              {row.valueType === 'boolean' ? (
                <OptionPicker
                  testID={`product-deliverable-${String(index)}-value`}
                  label={t('mobile.studio.products.form.deliverableValueLabel')}
                  options={[
                    { value: 'true', label: t('mobile.studio.products.form.deliverableValueYes') },
                    { value: 'false', label: t('mobile.studio.products.form.deliverableValueNo') },
                  ]}
                  value={row.value}
                  onChange={(value) => {
                    patchDeliverable(index, { value });
                  }}
                />
              ) : (
                <TextField
                  testID={`product-deliverable-${String(index)}-value`}
                  label={t('mobile.studio.products.form.deliverableValueLabel')}
                  value={row.value}
                  keyboardType={row.valueType === 'number' ? 'decimal-pad' : 'default'}
                  onChangeText={(text) => {
                    patchDeliverable(index, { value: text });
                  }}
                />
              )}
              <OutlineButton
                testID={`product-deliverable-${String(index)}-remove`}
                label={t('mobile.studio.products.form.removeDeliverableCta')}
                onPress={() => {
                  patch({ deliverables: values.deliverables.filter((_, i) => i !== index) });
                }}
              />
            </View>
          ))}
          <OutlineButton
            testID="product-add-deliverable"
            label={t('mobile.studio.products.form.addDeliverableCta')}
            onPress={() => {
              patch({ deliverables: [...values.deliverables, { ...EMPTY_DELIVERABLE }] });
            }}
          />
        </View>

        <View className="gap-3">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.studio.products.form.tiersHeading')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.studio.products.form.tiersHint')}
          </Text>
          {tiersError ? (
            <FormNotice tone="error" testID="product-tiers-error">
              {tiersError}
            </FormNotice>
          ) : null}
          {values.tiers.map((tier, index) => (
            <View
              key={index}
              className="gap-3 rounded-md border border-border p-3"
              testID={`product-tier-${String(index)}`}
            >
              <OptionPicker
                testID={`product-tier-${String(index)}-usage`}
                label={t('mobile.studio.products.form.tierUsageLabel')}
                options={LICENCE_USAGES.map((usage) => ({
                  value: usage,
                  label: t(`common.licenceUsages.${usage}`),
                }))}
                value={tier.usage}
                onChange={(value) => {
                  clearError(tierFieldPath(index, 'usage'));
                  patchTier(index, { usage: value as TierFormValue['usage'] });
                }}
                error={errors[tierFieldPath(index, 'usage')]}
              />
              <TextField
                testID={`product-tier-${String(index)}-price`}
                label={t('mobile.studio.products.form.tierPriceLabel')}
                hint={currencyHint}
                value={tier.price}
                keyboardType="decimal-pad"
                onChangeText={(text) => {
                  clearError(tierFieldPath(index, 'price'));
                  patchTier(index, { price: text });
                }}
                error={errors[tierFieldPath(index, 'price')]}
              />
              <TextField
                testID={`product-tier-${String(index)}-description`}
                label={t('mobile.studio.products.form.tierDescriptionLabel')}
                value={tier.description}
                maxLength={500}
                multiline
                textAlignVertical="top"
                onChangeText={(text) => {
                  clearError(tierFieldPath(index, 'description'));
                  patchTier(index, { description: text });
                }}
                error={errors[tierFieldPath(index, 'description')]}
              />
              <TextField
                testID={`product-tier-${String(index)}-licence`}
                label={t('mobile.studio.products.form.tierLicenceTextVersionLabel')}
                value={tier.licenceTextVersion}
                maxLength={20}
                autoCapitalize="none"
                onChangeText={(text) => {
                  clearError(tierFieldPath(index, 'licenceTextVersion'));
                  patchTier(index, { licenceTextVersion: text });
                }}
                error={errors[tierFieldPath(index, 'licenceTextVersion')]}
              />
              <OutlineButton
                testID={`product-tier-${String(index)}-remove`}
                label={t('mobile.studio.products.form.removeTierCta')}
                disabled={values.tiers.length <= 1}
                onPress={() => {
                  patch({ tiers: values.tiers.filter((_, i) => i !== index) });
                }}
              />
            </View>
          ))}
          <OutlineButton
            testID="product-add-tier"
            label={t('mobile.studio.products.form.addTierCta')}
            disabled={values.tiers.length >= MAX_TIERS}
            onPress={() => {
              patch({ tiers: [...values.tiers, { ...EMPTY_TIER }] });
            }}
          />
        </View>

        <PrimaryButton
          testID="product-submit"
          label={t(
            isSubmitting
              ? 'mobile.studio.products.form.saving'
              : existing
                ? 'mobile.studio.products.form.saveCta'
                : 'mobile.studio.products.form.createCta',
          )}
          onPress={() => void handleSubmit()}
          loading={isSubmitting}
        />
        {footer}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
