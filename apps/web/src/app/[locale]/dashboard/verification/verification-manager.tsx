'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import type { components } from '@photoo/api-client';
import { CreateVerificationCaseRequestSchema, type Locale } from '@photoo/shared';

import { ConfirmActionButton } from '@/components/requests/confirm-action-button';
import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { StatusBadge } from '@/components/requests/status-badge';
import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { fieldErrorMessage } from '@/lib/form-errors';
import { requestErrorMessage } from '@/lib/request-errors';

import {
  buildVerificationCasePayload,
  canStartNewVerificationCase,
  canSubmitVerificationCase,
  defaultVerificationBusinessFormValues,
  findDocumentForKey,
  mapValidationErrorDetailPath,
  mapVerificationIssuePath,
  type VerificationBusinessFormValues,
} from './verification-form-helpers';
import { VerificationDocumentSlot } from './verification-document-slot';

type RequiredDocument = components['schemas']['RequiredDocument'];
type VerificationCase = components['schemas']['VerificationCase'];
type VerificationDocument = components['schemas']['VerificationDocument'];

export function VerificationManager({
  locale,
  requirements,
  initialCase,
}: {
  locale: Locale;
  requirements: RequiredDocument[];
  initialCase: VerificationCase | null;
}) {
  const t = useTranslations('web.dashboard.verification');
  const tValidation = useTranslations('common.validation');

  const [verificationCase, setVerificationCase] = useState<VerificationCase | null>(initialCase);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsMessage, setDetailsMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [startNewCaseError, setStartNewCaseError] = useState<string | null>(null);
  const [startingNewCase, setStartingNewCase] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<VerificationBusinessFormValues>({
    defaultValues: defaultVerificationBusinessFormValues(verificationCase),
  });

  const isDraft = verificationCase?.status === 'draft';
  const canEditDetails = verificationCase === null || isDraft;

  async function onSaveDetails(values: VerificationBusinessFormValues) {
    setDetailsError(null);
    setDetailsMessage(null);
    clearErrors();

    const payload = buildVerificationCasePayload(values);
    const result = CreateVerificationCaseRequestSchema.safeParse(payload);
    if (!result.success) {
      let hasFieldError = false;
      for (const issue of result.error.issues) {
        const field = mapVerificationIssuePath(issue.path);
        if (field) {
          setError(field, { type: issue.code });
          hasFieldError = true;
        }
      }
      if (!hasFieldError) {
        setDetailsError(t('errors.invalid'));
      }
      return;
    }

    const { data, error } = verificationCase
      ? await api.PATCH('/v1/me/verification-case', { body: payload })
      : await api.POST('/v1/me/verification-case', { body: payload });

    if (!data) {
      if (error.code === 'VALIDATION_ERROR') {
        const fields = mapValidationErrorDetailPath(error.details);
        const hasFieldError = fields.some((field) => field !== null);
        for (const field of fields) {
          if (field) {
            setError(field, { type: 'custom' });
          }
        }
        if (!hasFieldError) {
          setDetailsError(t('errors.invalid'));
        }
        return;
      }
      setDetailsError(requestErrorMessage(t, error));
      return;
    }

    setVerificationCase(data);
    reset(defaultVerificationBusinessFormValues(data));
    setDetailsMessage(t(verificationCase ? 'detailsSaved' : 'caseStarted'));
  }

  function handleDocumentUploaded(document: VerificationDocument) {
    setVerificationCase((previous) => {
      if (!previous) {
        return previous;
      }
      return {
        ...previous,
        documents: [
          ...previous.documents.filter((existing) => existing.documentKey !== document.documentKey),
          document,
        ],
      };
    });
  }

  async function handleSubmitForReview(): Promise<boolean> {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error } = await api.POST('/v1/me/verification-case/submit');
      if (!data) {
        setSubmitError(requestErrorMessage(t, error));
        return false;
      }
      setVerificationCase(data);
      return true;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStartNewCase(): Promise<boolean> {
    setStartingNewCase(true);
    setStartNewCaseError(null);
    try {
      const { data, error } = await api.POST('/v1/me/verification-case', { body: {} });
      if (!data) {
        setStartNewCaseError(requestErrorMessage(t, error));
        return false;
      }
      setVerificationCase(data);
      reset(defaultVerificationBusinessFormValues(data));
      setDetailsMessage(null);
      setDetailsError(null);
      return true;
    } finally {
      setStartingNewCase(false);
    }
  }

  const canSubmit = verificationCase
    ? canSubmitVerificationCase(verificationCase, requirements)
    : false;

  return (
    <div className="flex flex-col gap-8">
      {verificationCase ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{t('statusHeading')}</h2>
            <StatusBadge
              label={t(`status.${verificationCase.status}`)}
              muted={verificationCase.status !== 'approved'}
            />
          </div>
          {verificationCase.submittedAt ? (
            <p className="text-sm text-muted-foreground">
              {t('submittedAtLabel')}:{' '}
              <FormattedDateTime
                value={verificationCase.submittedAt}
                locale={locale}
                timeStyle="short"
              />
            </p>
          ) : null}
          {verificationCase.decidedAt ? (
            <p className="text-sm text-muted-foreground">
              {t('decidedAtLabel')}:{' '}
              <FormattedDateTime
                value={verificationCase.decidedAt}
                locale={locale}
                timeStyle="short"
              />
            </p>
          ) : null}
          {verificationCase.rejectionReason ? (
            <FormNotice tone="error">
              <p className="font-medium">{t('rejectionReasonHeading')}</p>
              <p>{verificationCase.rejectionReason}</p>
            </FormNotice>
          ) : null}
          {canStartNewVerificationCase(verificationCase.status) ? (
            <ConfirmActionButton
              triggerLabel={t('startNewCaseCta')}
              triggerVariant="outline"
              title={t('startNewCaseConfirmTitle')}
              description={t('startNewCaseConfirmDescription')}
              confirmLabel={t('startNewCaseConfirmCta')}
              pendingLabel={t('startNewCasePending')}
              cancelLabel={t('startNewCaseCancelCta')}
              pending={startingNewCase}
              error={startNewCaseError}
              onOpen={() => {
                setStartNewCaseError(null);
              }}
              onConfirm={handleStartNewCase}
            />
          ) : null}
        </div>
      ) : null}

      {canEditDetails ? (
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSaveDetails)(event)}
          className="flex flex-col gap-4"
        >
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t('businessHeading')}</h2>
          </div>
          {detailsError ? <FormNotice tone="error">{detailsError}</FormNotice> : null}
          {detailsMessage ? <FormNotice tone="success">{detailsMessage}</FormNotice> : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="verification-business-name">{t('businessNameLabel')}</Label>
            <Input
              id="verification-business-name"
              aria-invalid={Boolean(errors.businessName)}
              {...register('businessName')}
            />
            <p className="text-sm text-muted-foreground">{t('businessNameRequiredHint')}</p>
            <FieldError
              id="verification-business-name-error"
              message={fieldErrorMessage(tValidation, errors.businessName)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="verification-vat-number">{t('vatNumberLabel')}</Label>
            <Input
              id="verification-vat-number"
              aria-invalid={Boolean(errors.vatNumber)}
              {...register('vatNumber')}
            />
            <FieldError
              id="verification-vat-number-error"
              message={fieldErrorMessage(tValidation, errors.vatNumber)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="verification-business-registration-number">
              {t('businessRegistrationNumberLabel')}
            </Label>
            <Input
              id="verification-business-registration-number"
              aria-invalid={Boolean(errors.businessRegistrationNumber)}
              {...register('businessRegistrationNumber')}
            />
            <FieldError
              id="verification-business-registration-number-error"
              message={fieldErrorMessage(tValidation, errors.businessRegistrationNumber)}
            />
          </div>

          <Button type="submit" disabled={isSubmitting} className="self-start">
            {isSubmitting ? t('saving') : t(verificationCase ? 'saveDetailsCta' : 'startCaseCta')}
          </Button>
        </form>
      ) : null}

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('documentsHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('documentsHint')}</p>
        </div>
        {verificationCase ? (
          <ul className="flex flex-col gap-3">
            {requirements.map((requirement) => (
              <VerificationDocumentSlot
                key={requirement.key}
                locale={locale}
                requirement={requirement}
                document={findDocumentForKey(verificationCase.documents, requirement.key)}
                readOnly={!isDraft}
                onUploaded={handleDocumentUploaded}
              />
            ))}
          </ul>
        ) : (
          <FormNotice tone="info">{t('documentsNeedCaseNotice')}</FormNotice>
        )}
      </div>

      {isDraft ? (
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t('submitHeading')}</h2>
            {!canSubmit ? (
              <p className="text-sm text-muted-foreground">{t('submitRequirementsHint')}</p>
            ) : null}
          </div>
          <ConfirmActionButton
            triggerLabel={t('submitCta')}
            title={t('submitConfirmTitle')}
            description={t('submitConfirmDescription')}
            confirmLabel={t('submitConfirmCta')}
            pendingLabel={t('submitPending')}
            cancelLabel={t('submitCancelCta')}
            disabled={!canSubmit}
            pending={submitting}
            error={submitError}
            onOpen={() => {
              setSubmitError(null);
            }}
            onConfirm={handleSubmitForReview}
          />
        </div>
      ) : null}
    </div>
  );
}
