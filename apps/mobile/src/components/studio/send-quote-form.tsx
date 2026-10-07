import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { CreateQuoteRequestSchema, resolveLocale } from '@photoo/shared';

import { api } from '../../lib/api';
import { fieldErrorMessages } from '../../lib/form-errors';
import { formatMoney, payoutAmount, requireMoney } from '../../lib/money';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedStudioTranslate,
} from '../../lib/request-errors';
import {
  EMPTY_LINE_ITEM,
  VALID_UNTIL_AFTER_REQUEST_EXPIRY_MESSAGE,
  buildSendQuotePayload,
  defaultSendQuoteFormValues,
  isAfterRequestExpiry,
  lineItemFieldPath,
  mapSendQuoteIssuePath,
  mapValidationErrorDetailPath,
  type LineItemField,
  type SendQuoteFieldPath,
  type SendQuoteFormValues,
} from '../../lib/send-quote-form';
import { DateTimeField } from '../form/date-time-field';
import { FormNotice } from '../form/form-notice';
import { PrimaryButton } from '../form/primary-button';
import { TextField } from '../form/text-field';

type RequestSummary = components['schemas']['RequestSummary'];
type QuotePreview = components['schemas']['QuotePreview'];
type FieldErrors = Partial<Record<SendQuoteFieldPath, string | undefined>>;
type Review =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; preview: QuotePreview };

export function SendQuoteForm({ request }: { request: RequestSummary }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = resolveLocale(i18n.language);
  const currency = request.budgetMin.currency;

  const [values, setValues] = useState<SendQuoteFormValues>(() =>
    defaultSendQuoteFormValues(request.expiresAt),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewStale, setReviewStale] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inFlight = useRef(false);
  const previewSeq = useRef(0);

  function changeLineItems(
    update: (current: SendQuoteFormValues['lineItems']) => SendQuoteFormValues['lineItems'],
  ) {
    previewSeq.current += 1;
    setReviewStale(review !== null);
    setReview(null);
    setSubmitError(null);
    setValues((current) => ({ ...current, lineItems: update(current.lineItems) }));
  }

  function setLineItemField(index: number, key: LineItemField, text: string) {
    changeLineItems((items) =>
      items.map((item, position) => (position === index ? { ...item, [key]: text } : item)),
    );
    setErrors((current) => ({ ...current, [lineItemFieldPath(index, key)]: undefined }));
  }

  function validate() {
    const payload = buildSendQuotePayload(request.id, values);
    const parsed = CreateQuoteRequestSchema.safeParse(payload);
    const next: FieldErrors = {};
    let hasUnmappedIssue = false;

    if (!parsed.success) {
      const messages = fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error);
      for (const issue of parsed.error.issues) {
        const field = mapSendQuoteIssuePath(issue.path);
        if (!field) {
          hasUnmappedIssue = true;
        } else if (field.endsWith('.qty')) {
          next[field] = t('mobile.studio.requests.sendQuote.invalidQty');
        } else if (field.endsWith('.unitPrice')) {
          next[field] = t('mobile.studio.requests.sendQuote.invalidAmount');
        } else {
          next[field] = messages[issue.path.join('.')] ?? t('common.validation.invalid');
        }
      }
    }
    if (isAfterRequestExpiry(values.validUntil, request.expiresAt)) {
      next.validUntil = t('mobile.studio.requests.sendQuote.validUntilAfterRequestExpiry');
    }

    setErrors(next);
    const hasErrors = Object.keys(next).length > 0 || hasUnmappedIssue;
    setFormError(
      hasErrors && Object.keys(next).length === 0
        ? t('mobile.studio.requests.sendQuote.invalidForm')
        : null,
    );
    return hasErrors ? null : payload;
  }

  async function loadPreview() {
    setSubmitError(null);
    const payload = validate();
    if (!payload) {
      return;
    }
    previewSeq.current += 1;
    const seq = previewSeq.current;
    setReviewStale(false);
    setReview({ status: 'loading' });
    try {
      const { data, response } = await api.POST('/v1/quotes/preview', {
        body: { lineItems: payload.lineItems },
      });
      if (seq !== previewSeq.current) {
        return;
      }
      if (data) {
        setReview({ status: 'ready', preview: data });
      } else {
        if (response.status === 401) {
          setUnauthorized(true);
        }
        setReview({ status: 'error' });
      }
    } catch {
      if (seq === previewSeq.current) {
        setReview({ status: 'error' });
      }
    }
  }

  async function send() {
    if (inFlight.current) {
      return;
    }
    const payload = validate();
    if (!payload) {
      return;
    }
    inFlight.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    const translate = scopedStudioTranslate(t, 'requests');
    try {
      const { error, response } = await api.POST('/v1/quotes', { body: payload });
      if (!error) {
        router.replace('/studio/quotes');
        return;
      }
      const apiError = apiErrorWithStatus(error, response.status);
      if (response.status === 401) {
        setUnauthorized(true);
        return;
      }
      if (apiError.code === 'VALIDATION_ERROR') {
        const fields = mapValidationErrorDetailPath(apiError.details).filter(
          (field): field is SendQuoteFieldPath => field !== null,
        );
        setErrors(
          Object.fromEntries(fields.map((field) => [field, t('common.validation.invalid')])),
        );
        setReview(null);
        if (fields.length === 0) {
          setSubmitError(requestErrorMessage(translate, apiError));
        }
        return;
      }
      if (
        apiError.code === 'UNPROCESSABLE_ENTITY' &&
        apiError.message === VALID_UNTIL_AFTER_REQUEST_EXPIRY_MESSAGE
      ) {
        setErrors({
          validUntil: t('mobile.studio.requests.sendQuote.validUntilAfterRequestExpiry'),
        });
        return;
      }
      setSubmitError(requestErrorMessage(translate, apiError));
    } catch {
      setSubmitError(t('mobile.studio.requests.errors.generic'));
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  }

  if (unauthorized) {
    return (
      <FormNotice tone="error" testID="send-quote-unauthorized">
        {t('mobile.studio.sessionExpired')}
      </FormNotice>
    );
  }

  const preview = review?.status === 'ready' ? review.preview : null;
  const previewSubtotal = preview ? requireMoney(preview.subtotal, 'quote preview subtotal') : null;
  const previewFee = preview
    ? requireMoney(preview.platformFee, 'quote preview platform fee')
    : null;
  const previewTotal = preview ? requireMoney(preview.total, 'quote preview total') : null;

  return (
    <View className="gap-4" testID="send-quote-form">
      <View className="gap-1">
        <Text className="text-lg font-semibold text-foreground">
          {t('mobile.studio.requests.sendQuote.title')}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {t('mobile.studio.requests.sendQuote.intro')}
        </Text>
      </View>

      {formError ? (
        <FormNotice tone="error" testID="send-quote-form-error">
          {formError}
        </FormNotice>
      ) : null}

      <View className="gap-3">
        <Text className="text-sm font-semibold text-foreground">
          {t('mobile.studio.requests.sendQuote.lineItemsHeading')}
        </Text>
        {values.lineItems.map((item, index) => (
          <View key={index} className="gap-2 rounded-md border border-border p-3">
            <TextField
              testID={`line-item-label-${String(index)}`}
              label={t('mobile.studio.requests.sendQuote.lineItemLabel')}
              value={item.label}
              onChangeText={(text) => {
                setLineItemField(index, 'label', text);
              }}
              editable={!isSubmitting}
              error={errors[lineItemFieldPath(index, 'label')]}
            />
            <TextField
              testID={`line-item-qty-${String(index)}`}
              label={t('mobile.studio.requests.sendQuote.lineItemQty')}
              value={item.qty}
              onChangeText={(text) => {
                setLineItemField(index, 'qty', text);
              }}
              keyboardType="number-pad"
              editable={!isSubmitting}
              error={errors[lineItemFieldPath(index, 'qty')]}
            />
            <TextField
              testID={`line-item-price-${String(index)}`}
              label={t('mobile.studio.requests.sendQuote.lineItemPrice', { currency })}
              hint={t('mobile.studio.requests.sendQuote.lineItemPriceHint')}
              value={item.unitPrice}
              onChangeText={(text) => {
                setLineItemField(index, 'unitPrice', text);
              }}
              keyboardType="decimal-pad"
              editable={!isSubmitting}
              error={errors[lineItemFieldPath(index, 'unitPrice')]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: values.lineItems.length <= 1 || isSubmitting }}
              disabled={values.lineItems.length <= 1 || isSubmitting}
              onPress={() => {
                changeLineItems((items) => items.filter((_, position) => position !== index));
                setErrors({});
              }}
              testID={`line-item-remove-${String(index)}`}
              className={`min-h-11 justify-center self-start ${values.lineItems.length <= 1 ? 'opacity-50' : ''}`}
            >
              <Text className="text-sm font-medium text-foreground underline">
                {t('mobile.studio.requests.sendQuote.removeLineItemCta')}
              </Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={() => {
            changeLineItems((items) => [...items, { ...EMPTY_LINE_ITEM }]);
          }}
          testID="line-item-add"
          className="min-h-11 justify-center self-start"
        >
          <Text className="text-base font-medium text-foreground underline">
            {t('mobile.studio.requests.sendQuote.addLineItemCta')}
          </Text>
        </Pressable>
      </View>

      <DateTimeField
        testID="send-quote-valid-until"
        label={t('mobile.studio.requests.sendQuote.validUntilLabel')}
        placeholder={t('mobile.studio.requests.sendQuote.validUntilPlaceholder')}
        value={values.validUntil}
        minimumDate={new Date()}
        locale={locale}
        onChange={(date) => {
          setValues((current) => ({ ...current, validUntil: date }));
          setErrors((current) => ({ ...current, validUntil: undefined }));
        }}
        error={errors.validUntil}
      />

      <TextField
        testID="send-quote-message"
        label={t('mobile.studio.requests.sendQuote.messageLabel')}
        value={values.message}
        onChangeText={(text) => {
          setValues((current) => ({ ...current, message: text }));
          setErrors((current) => ({ ...current, message: undefined }));
        }}
        multiline
        textAlignVertical="top"
        editable={!isSubmitting}
        error={errors.message}
      />

      {submitError ? (
        <FormNotice tone="error" testID="send-quote-error">
          {submitError}
        </FormNotice>
      ) : null}

      {reviewStale ? (
        <FormNotice tone="info" testID="send-quote-review-stale">
          {t('mobile.studio.requests.sendQuote.reviewStale')}
        </FormNotice>
      ) : null}

      {review === null ? (
        <PrimaryButton
          testID="send-quote-review"
          label={t('mobile.studio.requests.sendQuote.reviewCta')}
          onPress={() => void loadPreview()}
        />
      ) : (
        <View
          className="gap-3 rounded-md border border-border bg-muted p-4"
          testID="send-quote-review-panel"
        >
          <Text className="text-base font-semibold text-foreground">
            {t('mobile.studio.requests.sendQuote.reviewTitle')}
          </Text>
          {review.status === 'loading' ? (
            <Text className="text-sm text-muted-foreground" testID="send-quote-preview-loading">
              {t('mobile.studio.requests.sendQuote.reviewLoading')}
            </Text>
          ) : null}
          {review.status === 'error' ? (
            <View className="gap-1" testID="send-quote-preview-error" accessibilityRole="alert">
              <Text className="text-sm text-muted-foreground">
                {t('mobile.studio.requests.sendQuote.reviewError')}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void loadPreview()}
                testID="send-quote-preview-retry"
                className="min-h-11 justify-center"
              >
                <Text className="text-sm font-medium text-foreground underline">
                  {t('mobile.studio.requests.sendQuote.reviewRetryCta')}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {previewSubtotal && previewFee && previewTotal ? (
            <View className="gap-1" testID="send-quote-preview">
              <View className="flex-row justify-between gap-2">
                <Text className="font-medium text-foreground">
                  {t('mobile.studio.requests.sendQuote.totalLabel')}
                </Text>
                <Text className="font-medium text-foreground" testID="send-quote-preview-total">
                  {formatMoney(previewTotal, locale)}
                </Text>
              </View>
              <View className="flex-row justify-between gap-2">
                <Text className="text-sm text-muted-foreground">
                  {t('mobile.studio.requests.sendQuote.feeLabel')}
                </Text>
                <Text className="text-sm text-muted-foreground" testID="send-quote-preview-fee">
                  {`−${formatMoney(previewFee, locale)}`}
                </Text>
              </View>
              <View className="flex-row justify-between gap-2">
                <Text className="text-sm text-muted-foreground">
                  {t('mobile.studio.requests.sendQuote.payoutLabel')}
                </Text>
                <Text className="text-sm text-muted-foreground" testID="send-quote-preview-payout">
                  {formatMoney(payoutAmount(previewSubtotal, previewFee), locale)}
                </Text>
              </View>
              <Text className="pt-1 text-sm text-muted-foreground">
                {t('mobile.studio.requests.sendQuote.feeNotice')}
              </Text>
            </View>
          ) : null}
          <PrimaryButton
            testID="send-quote-send"
            label={
              isSubmitting
                ? t('mobile.studio.requests.sendQuote.sending')
                : t('mobile.studio.requests.sendQuote.confirmSendCta')
            }
            loading={isSubmitting}
            disabled={review.status === 'loading'}
            onPress={() => void send()}
          />
        </View>
      )}
    </View>
  );
}
