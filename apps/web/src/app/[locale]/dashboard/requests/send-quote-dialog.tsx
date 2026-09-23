'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';

import type { components } from '@photoo/api-client';
import { CreateQuoteRequestSchema, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { fieldErrorMessage } from '@/lib/form-errors';
import { formatMoney } from '@/lib/money';
import { requestErrorMessage } from '@/lib/request-errors';

import {
  buildSendQuotePayload,
  defaultSendQuoteFormValues,
  EMPTY_LINE_ITEM,
  lineItemsSubtotalCents,
  mapSendQuoteIssuePath,
  mapValidationErrorDetailPath,
  toDateTimeLocal,
  type SendQuoteFormValues,
} from './send-quote-form-helpers';

// The one 422 message `quotes.service.ts#createForRequest` throws that names
// a specific field; every other CONFLICT/UNPROCESSABLE_ENTITY case is a
// business-rule failure with nothing on the form to highlight.
const VALID_UNTIL_AFTER_REQUEST_EXPIRY_MESSAGE = 'validUntil must not be after the request expires';

type RequestSummary = components['schemas']['RequestSummary'];
// Deliberately typed from `buildSendQuotePayload`, not from
// `CreateQuoteRequestSchema`'s own inferred output: zod's `.optional()`
// widens `message` to `string | undefined`, which `exactOptionalPropertyTypes`
// rejects against the API's `message?: string` - same issue and same fix as
// requests/new/request-form.tsx's `address` field. Parsing doesn't transform
// anything here, so the hand-built payload is value-identical to `result.data`.
type SendQuotePayload = ReturnType<typeof buildSendQuotePayload>;

function lineItemFieldName(
  index: number,
  key: 'label' | 'qty' | 'unitPrice',
): `lineItems.${number}.label` | `lineItems.${number}.qty` | `lineItems.${number}.unitPrice` {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- index is always a field array position, not user content
  return `lineItems.${index}.${key}`;
}

export function SendQuoteDialog({ request, locale }: { request: RequestSummary; locale: Locale }) {
  const t = useTranslations('web.dashboard.requests.sendQuote');
  const tValidation = useTranslations('common.validation');

  const router = useRouter();
  const currency = request.budgetMin.currency;

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [reviewPayload, setReviewPayload] = useState<SendQuotePayload | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    clearErrors,
    reset,
    formState: { errors },
  } = useForm<SendQuoteFormValues>({
    defaultValues: defaultSendQuoteFormValues(request.expiresAt),
  });
  const lineItems = useFieldArray({ control, name: 'lineItems' });

  function handleOpenChange(next: boolean) {
    if (pending) {
      return;
    }
    setOpen(next);
    setStep('form');
    setReviewPayload(null);
    setFormError(null);
    setSubmitError(null);
    clearErrors();
    // Recomputed on every open, not just on close: a photographer who opens
    // the dialog well after page load would otherwise see a default
    // computed at mount time, which can already be past the request's
    // expiry for a request closing within minutes.
    reset(defaultSendQuoteFormValues(request.expiresAt));
  }

  function onReview(values: SendQuoteFormValues) {
    setFormError(null);
    clearErrors();

    const payload = buildSendQuotePayload(request.id, values);
    // Runs the same zod contract the API enforces so client-side errors
    // mirror server-side ones field for field.
    const result = CreateQuoteRequestSchema.safeParse(payload);
    if (!result.success) {
      let hasFieldError = false;
      for (const issue of result.error.issues) {
        const field = mapSendQuoteIssuePath(issue.path);
        if (field) {
          setError(field, { type: issue.code });
          hasFieldError = true;
        }
      }
      if (!hasFieldError) {
        setFormError(t('invalidForm'));
      }
      return;
    }

    setReviewPayload(payload);
    setStep('review');
  }

  async function confirmSend() {
    if (!reviewPayload) {
      return;
    }
    setPending(true);
    setSubmitError(null);
    try {
      const { data, error } = await api.POST('/v1/quotes', { body: reviewPayload });
      if (error) {
        if (error.code === 'VALIDATION_ERROR') {
          const fields = mapValidationErrorDetailPath(error.details);
          const hasFieldError = fields.some((field) => field !== null);
          for (const field of fields) {
            if (field) {
              setError(field, { type: 'custom' });
            }
          }
          setStep('form');
          if (!hasFieldError) {
            setSubmitError(requestErrorMessage(t, error));
          }
          return;
        }
        if (
          error.code === 'UNPROCESSABLE_ENTITY' &&
          error.message === VALID_UNTIL_AFTER_REQUEST_EXPIRY_MESSAGE
        ) {
          setError('validUntil', { type: 'custom' });
          setStep('form');
          return;
        }
        setSubmitError(requestErrorMessage(t, error));
        return;
      }
      setOpen(false);
      router.push(`/${locale}/quotes/${data.id}`);
    } catch {
      setSubmitError(requestErrorMessage(t, undefined));
    } finally {
      setPending(false);
    }
  }

  const reviewSubtotal = reviewPayload
    ? { amountCents: lineItemsSubtotalCents(reviewPayload.lineItems), currency }
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button">{t('triggerCta')}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        {step === 'form' ? (
          <>
            <DialogTitle className="text-lg font-semibold text-foreground">
              {t('formTitle')}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t('formDescription')}
            </DialogDescription>
            <form
              noValidate
              onSubmit={(event) => void handleSubmit(onReview)(event)}
              className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto"
            >
              {formError ? <FormNotice tone="error">{formError}</FormNotice> : null}

              <fieldset className="flex flex-col gap-3">
                <legend className="text-sm font-semibold text-foreground">
                  {t('lineItemsHeading')}
                </legend>
                {lineItems.fields.map((field, index) => (
                  <div
                    key={field.id}
                    className="flex flex-col gap-2 rounded-md border border-border p-3"
                  >
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`line-item-label-${field.id}`}>
                        {t('lineItemLabelLabel')}
                      </Label>
                      <Input
                        id={`line-item-label-${field.id}`}
                        aria-invalid={Boolean(errors.lineItems?.[index]?.label)}
                        {...register(lineItemFieldName(index, 'label'))}
                      />
                      <FieldError
                        id={`line-item-label-${field.id}-error`}
                        message={fieldErrorMessage(tValidation, errors.lineItems?.[index]?.label)}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`line-item-qty-${field.id}`}>{t('lineItemQtyLabel')}</Label>
                        <Input
                          id={`line-item-qty-${field.id}`}
                          type="number"
                          min={1}
                          step="1"
                          inputMode="numeric"
                          aria-invalid={Boolean(errors.lineItems?.[index]?.qty)}
                          {...register(lineItemFieldName(index, 'qty'))}
                        />
                        <FieldError
                          id={`line-item-qty-${field.id}-error`}
                          message={fieldErrorMessage(tValidation, errors.lineItems?.[index]?.qty)}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`line-item-price-${field.id}`}>
                          {t('lineItemPriceLabel', { currency })}
                        </Label>
                        <Input
                          id={`line-item-price-${field.id}`}
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          aria-invalid={Boolean(errors.lineItems?.[index]?.unitPrice)}
                          {...register(lineItemFieldName(index, 'unitPrice'))}
                        />
                        <FieldError
                          id={`line-item-price-${field.id}-error`}
                          message={fieldErrorMessage(
                            tValidation,
                            errors.lineItems?.[index]?.unitPrice,
                          )}
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="self-start"
                      disabled={lineItems.fields.length <= 1}
                      onClick={() => {
                        lineItems.remove(index);
                      }}
                    >
                      {t('removeLineItemCta')}
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="self-start"
                  onClick={() => {
                    lineItems.append(EMPTY_LINE_ITEM);
                  }}
                >
                  {t('addLineItemCta')}
                </Button>
              </fieldset>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="send-quote-valid-until">{t('validUntilLabel')}</Label>
                <Input
                  id="send-quote-valid-until"
                  type="datetime-local"
                  max={request.expiresAt ? toDateTimeLocal(new Date(request.expiresAt)) : undefined}
                  aria-invalid={Boolean(errors.validUntil)}
                  {...register('validUntil')}
                />
                <FieldError
                  id="send-quote-valid-until-error"
                  message={fieldErrorMessage(tValidation, errors.validUntil)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="send-quote-message">{t('messageLabel')}</Label>
                <Textarea
                  id="send-quote-message"
                  aria-invalid={Boolean(errors.message)}
                  {...register('message')}
                />
                <FieldError
                  id="send-quote-message-error"
                  message={fieldErrorMessage(tValidation, errors.message)}
                />
              </div>

              <div className="flex justify-end gap-3">
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    {t('cancelCta')}
                  </Button>
                </DialogClose>
                <Button type="submit">{t('reviewCta')}</Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogTitle className="text-lg font-semibold text-foreground">
              {t('reviewTitle')}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t('reviewDescription')}
            </DialogDescription>
            {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
            {reviewPayload && reviewSubtotal ? (
              <div className="flex flex-col gap-2">
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {reviewPayload.lineItems.map((item, index) => (
                    <li
                      key={`${item.label}-${String(index)}`}
                      className="flex items-center justify-between gap-2"
                    >
                      <span>{item.label}</span>
                      <span>
                        {item.qty} ×{' '}
                        {formatMoney({ amountCents: item.unitCents, currency }, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-2 font-medium text-foreground">
                  <span>{t('totalLabel')}</span>
                  <span>{formatMoney(reviewSubtotal, locale)}</span>
                </div>
                <p className="text-sm text-muted-foreground">{t('feeNotice')}</p>
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setStep('form');
                }}
              >
                {t('backCta')}
              </Button>
              <Button
                type="button"
                disabled={pending}
                aria-busy={pending}
                onClick={() => void confirmSend()}
              >
                {pending ? t('sending') : t('confirmSendCta')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
