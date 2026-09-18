'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';

import type { components } from '@photoo/api-client';
import {
  CreateProductRequestSchema,
  LICENCE_USAGES,
  PHOTOGRAPHER_CATEGORIES,
  SUPPORTED_LOCALES,
  UpdateProductRequestSchema,
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

import {
  buildProductPayload,
  defaultValuesFromProduct,
  EMPTY_DELIVERABLE,
  EMPTY_PRODUCT_FORM_VALUES,
  EMPTY_TIER,
  hasDuplicateDeliverableKeys,
  hasDuplicateTierUsage,
  mapProductIssuePath,
  mapValidationErrorDetailPath,
  type ProductFormValues,
} from './product-form-helpers';

type Product = components['schemas']['Product'];

const SELECT_CLASSNAME =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

type TierFieldKey = 'usage' | 'price' | 'description' | 'licenceTextVersion';
type DeliverableFieldKey = 'key' | 'valueType' | 'value';

function tierFieldName(
  index: number,
  key: TierFieldKey,
):
  | `tiers.${number}.usage`
  | `tiers.${number}.price`
  | `tiers.${number}.description`
  | `tiers.${number}.licenceTextVersion` {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- index is always a field array position, not user content
  return `tiers.${index}.${key}`;
}

function deliverableFieldName(
  index: number,
  key: DeliverableFieldKey,
):
  | `deliverables.${number}.key`
  | `deliverables.${number}.valueType`
  | `deliverables.${number}.value` {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- index is always a field array position, not user content
  return `deliverables.${index}.${key}`;
}

export function ProductForm({
  locale,
  existing,
  currency,
}: {
  locale: Locale;
  existing: Product | null;
  currency: string;
}) {
  const t = useTranslations('web.dashboard.products.form');
  const tCategories = useTranslations('common.categories');
  const tLicenceUsages = useTranslations('common.licenceUsages');
  const tLocale = useTranslations('locale');
  const tValidation = useTranslations('common.validation');
  const tErrors = useTranslations('web.dashboard.products');
  const router = useRouter();

  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    defaultValues: existing ? defaultValuesFromProduct(existing) : EMPTY_PRODUCT_FORM_VALUES,
  });

  const tiers = useFieldArray({ control, name: 'tiers' });
  const deliverables = useFieldArray({ control, name: 'deliverables' });
  const deliverableValues = useWatch({ control, name: 'deliverables' });

  const [titleError, setTitleError] = useState<string | null>(null);
  const [tiersError, setTiersError] = useState<string | null>(null);
  const [deliverablesError, setDeliverablesError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function onSubmit(values: ProductFormValues) {
    setTitleError(null);
    setTiersError(null);
    setDeliverablesError(null);
    setSubmitError(null);
    setSuccessMessage(null);
    clearErrors();

    const hasTitle = SUPPORTED_LOCALES.some((sl) => values.title[sl].trim() !== '');
    if (!hasTitle) {
      setTitleError(t('titleRequired'));
      return;
    }
    if (hasDuplicateTierUsage(values.tiers)) {
      setTiersError(t('duplicateTierUsage'));
      return;
    }
    if (hasDuplicateDeliverableKeys(values.deliverables)) {
      setDeliverablesError(t('duplicateDeliverableKey'));
      return;
    }

    const payload = buildProductPayload(values, currency);

    function reportInvalid(issues: { path: readonly PropertyKey[]; code: string }[]): void {
      let hasFieldError = false;
      for (const issue of issues) {
        const field = mapProductIssuePath(issue.path);
        if (field) {
          setError(field, { type: issue.code });
          hasFieldError = true;
        }
      }
      if (!hasFieldError) {
        setSubmitError(tErrors('errors.invalid'));
      }
    }

    const schema = existing ? UpdateProductRequestSchema : CreateProductRequestSchema;
    const result = schema.safeParse(payload);
    if (!result.success) {
      reportInvalid(result.error.issues);
      return;
    }

    const { error } = existing
      ? await api.PATCH('/v1/me/products/{productId}', {
          params: { path: { productId: existing.id } },
          body: payload,
        })
      : await api.POST('/v1/me/products', { body: payload });

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

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('titleHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('titleHint')}</p>
        </div>
        {SUPPORTED_LOCALES.map((titleLocale) => (
          <div key={titleLocale} className="flex flex-col gap-1.5">
            <Label htmlFor={`product-title-${titleLocale}`}>
              {t('titleLabel', { language: tLocale(titleLocale) })}
            </Label>
            <Input id={`product-title-${titleLocale}`} {...register(`title.${titleLocale}`)} />
          </div>
        ))}
        <FieldError id="product-title-error" message={titleError ?? undefined} />
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('descriptionHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('descriptionHint')}</p>
        </div>
        {SUPPORTED_LOCALES.map((descriptionLocale) => (
          <div key={descriptionLocale} className="flex flex-col gap-1.5">
            <Label htmlFor={`product-description-${descriptionLocale}`}>
              {t('descriptionLabel', { language: tLocale(descriptionLocale) })}
            </Label>
            <Textarea
              id={`product-description-${descriptionLocale}`}
              {...register(`description.${descriptionLocale}`)}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-category">{t('categoryLabel')}</Label>
        <select
          id="product-category"
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
          id="product-category-error"
          message={fieldErrorMessage(tValidation, errors.category)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-duration">{t('durationMinutesLabel')}</Label>
        <Input
          id="product-duration"
          type="number"
          min={1}
          step="1"
          inputMode="numeric"
          aria-invalid={Boolean(errors.durationMinutes)}
          {...register('durationMinutes')}
        />
        <FieldError
          id="product-duration-error"
          message={fieldErrorMessage(tValidation, errors.durationMinutes)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="product-base-price">{t('basePriceLabel')}</Label>
        <p className="text-sm text-muted-foreground">{t('currencyHint', { currency })}</p>
        <Input
          id="product-base-price"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          aria-invalid={Boolean(errors.basePrice)}
          {...register('basePrice')}
        />
        <FieldError
          id="product-base-price-error"
          message={fieldErrorMessage(tValidation, errors.basePrice)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" className="size-4" {...register('isActive')} />
        {t('isActiveLabel')}
      </label>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-lg font-semibold text-foreground">
          {t('deliverablesHeading')}
        </legend>
        <p className="text-sm text-muted-foreground">{t('deliverablesHint')}</p>
        {deliverablesError ? <FormNotice tone="error">{deliverablesError}</FormNotice> : null}
        {deliverables.fields.map((field, index) => (
          <div
            key={field.id}
            className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-4"
          >
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor={`deliverable-key-${field.id}`}>{t('deliverableKeyLabel')}</Label>
              <Input
                id={`deliverable-key-${field.id}`}
                placeholder={t('deliverableKeyPlaceholder')}
                {...register(deliverableFieldName(index, 'key'))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`deliverable-type-${field.id}`}>{t('deliverableTypeLabel')}</Label>
              <select
                id={`deliverable-type-${field.id}`}
                className={SELECT_CLASSNAME}
                {...register(deliverableFieldName(index, 'valueType'))}
              >
                <option value="text">{t('deliverableType.text')}</option>
                <option value="number">{t('deliverableType.number')}</option>
                <option value="boolean">{t('deliverableType.boolean')}</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`deliverable-value-${field.id}`}>{t('deliverableValueLabel')}</Label>
              {deliverableValues[index]?.valueType === 'boolean' ? (
                <select
                  id={`deliverable-value-${field.id}`}
                  className={SELECT_CLASSNAME}
                  {...register(deliverableFieldName(index, 'value'))}
                >
                  <option value="true">{t('deliverableValueYes')}</option>
                  <option value="false">{t('deliverableValueNo')}</option>
                </select>
              ) : (
                <Input
                  id={`deliverable-value-${field.id}`}
                  type={deliverableValues[index]?.valueType === 'number' ? 'number' : 'text'}
                  {...register(deliverableFieldName(index, 'value'))}
                />
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              className="sm:col-span-4 self-start"
              onClick={() => {
                deliverables.remove(index);
              }}
            >
              {t('removeDeliverableCta')}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => {
            deliverables.append(EMPTY_DELIVERABLE);
          }}
        >
          {t('addDeliverableCta')}
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-lg font-semibold text-foreground">{t('tiersHeading')}</legend>
        <p className="text-sm text-muted-foreground">{t('tiersHint')}</p>
        {tiersError ? <FormNotice tone="error">{tiersError}</FormNotice> : null}
        {tiers.fields.map((field, index) => (
          <div key={field.id} className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`tier-usage-${field.id}`}>{t('tierUsageLabel')}</Label>
              <select
                id={`tier-usage-${field.id}`}
                aria-invalid={Boolean(errors.tiers?.[index]?.usage)}
                className={SELECT_CLASSNAME}
                {...register(tierFieldName(index, 'usage'))}
              >
                <option value="">{t('tierUsagePlaceholder')}</option>
                {LICENCE_USAGES.map((usage) => (
                  <option key={usage} value={usage}>
                    {tLicenceUsages(usage)}
                  </option>
                ))}
              </select>
              <FieldError
                id={`tier-usage-${field.id}-error`}
                message={fieldErrorMessage(tValidation, errors.tiers?.[index]?.usage)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`tier-price-${field.id}`}>{t('tierPriceLabel')}</Label>
              <p className="text-sm text-muted-foreground">{t('currencyHint', { currency })}</p>
              <Input
                id={`tier-price-${field.id}`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                aria-invalid={Boolean(errors.tiers?.[index]?.price)}
                {...register(tierFieldName(index, 'price'))}
              />
              <FieldError
                id={`tier-price-${field.id}-error`}
                message={fieldErrorMessage(tValidation, errors.tiers?.[index]?.price)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`tier-description-${field.id}`}>{t('tierDescriptionLabel')}</Label>
              <Textarea
                id={`tier-description-${field.id}`}
                aria-invalid={Boolean(errors.tiers?.[index]?.description)}
                {...register(tierFieldName(index, 'description'))}
              />
              <FieldError
                id={`tier-description-${field.id}-error`}
                message={fieldErrorMessage(tValidation, errors.tiers?.[index]?.description)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`tier-licence-${field.id}`}>{t('tierLicenceTextVersionLabel')}</Label>
              <Input
                id={`tier-licence-${field.id}`}
                aria-invalid={Boolean(errors.tiers?.[index]?.licenceTextVersion)}
                {...register(tierFieldName(index, 'licenceTextVersion'))}
              />
              <FieldError
                id={`tier-licence-${field.id}-error`}
                message={fieldErrorMessage(tValidation, errors.tiers?.[index]?.licenceTextVersion)}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              className="self-start"
              disabled={tiers.fields.length <= 1}
              onClick={() => {
                tiers.remove(index);
              }}
            >
              {t('removeTierCta')}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          className="self-start"
          onClick={() => {
            tiers.append(EMPTY_TIER);
          }}
        >
          {t('addTierCta')}
        </Button>
      </fieldset>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={isSubmitting} className="self-start">
          {isSubmitting ? t('saving') : t(existing ? 'saveCta' : 'createCta')}
        </Button>
        <Link
          href={`/${locale}/dashboard/products`}
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {t('backToList')}
        </Link>
      </div>
    </form>
  );
}
