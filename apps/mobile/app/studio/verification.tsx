import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { CreateVerificationCaseRequestSchema, resolveLocale } from '@photoo/shared';

import { FormNotice } from '../../src/components/form/form-notice';
import { PrimaryButton } from '../../src/components/form/primary-button';
import { TextField } from '../../src/components/form/text-field';
import { ConfirmAction } from '../../src/components/requests/confirm-action';
import {
  StudioFrame,
  StudioLoading,
  StudioMessage,
} from '../../src/components/studio/studio-frame';
import { VerificationSlot } from '../../src/components/studio/verification-slot';
import { api } from '../../src/lib/api';
import { formatDateTime } from '../../src/lib/date-format';
import {
  apiErrorWithStatus,
  requestErrorMessage,
  scopedStudioTranslate,
} from '../../src/lib/request-errors';
import { useVerificationCase } from '../../src/lib/use-verification-case';
import { useVerificationUploads } from '../../src/lib/use-verification-uploads';
import {
  buildCasePayload,
  canStartNewVerificationCase,
  canSubmitVerificationCase,
  findDocumentForKey,
  mapCaseIssuePath,
  valuesFromCase,
  type VerificationBusinessErrors,
  type VerificationBusinessValues,
} from '../../src/lib/verification-form';

type RequiredDocument = components['schemas']['RequiredDocument'];
type VerificationCase = components['schemas']['VerificationCase'];
type VerificationDocument = components['schemas']['VerificationDocument'];

const BUSINESS_FIELDS = [
  ['businessName', 'businessNameLabel'],
  ['vatNumber', 'vatNumberLabel'],
  ['businessRegistrationNumber', 'businessRegistrationNumberLabel'],
] as const;

function CaseStatus({
  verificationCase,
  onStartNew,
  startingNew,
}: {
  verificationCase: VerificationCase;
  onStartNew: () => Promise<void>;
  startingNew: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);

  return (
    <View className="gap-2 rounded-md border border-border p-4" testID="verification-status">
      <Text className="text-lg font-semibold text-foreground">
        {t('mobile.studio.verification.statusHeading')}
      </Text>
      <Text className="text-base text-foreground" testID="verification-status-label">
        {t(`mobile.studio.verification.status.${verificationCase.status}`)}
      </Text>
      {verificationCase.submittedAt ? (
        <Text className="text-sm text-muted-foreground">
          {t('mobile.studio.verification.submittedAtLabel')}:{' '}
          {formatDateTime(verificationCase.submittedAt, locale)}
        </Text>
      ) : null}
      {verificationCase.decidedAt ? (
        <Text className="text-sm text-muted-foreground">
          {t('mobile.studio.verification.decidedAtLabel')}:{' '}
          {formatDateTime(verificationCase.decidedAt, locale)}
        </Text>
      ) : null}
      {verificationCase.rejectionReason ? (
        <FormNotice tone="error" testID="verification-rejection">
          {`${t('mobile.studio.verification.rejectionReasonHeading')}: ${verificationCase.rejectionReason}`}
        </FormNotice>
      ) : null}
      {verificationCase.status === 'submitted' || verificationCase.status === 'in_review' ? (
        <Text className="text-sm text-muted-foreground" testID="verification-read-only">
          {t('mobile.studio.verification.readOnlyNotice')}
        </Text>
      ) : null}
      {canStartNewVerificationCase(verificationCase.status) ? (
        <ConfirmAction
          testID="verification-start-new"
          outline
          triggerLabel={t('mobile.studio.verification.startNewCaseCta')}
          title={t('mobile.studio.verification.startNewCaseConfirmTitle')}
          description={t('mobile.studio.verification.startNewCaseConfirmDescription')}
          confirmLabel={t('mobile.studio.verification.startNewCaseConfirmCta')}
          pendingLabel={t('mobile.studio.verification.startNewCasePending')}
          dismissLabel={t('mobile.studio.verification.startNewCaseDismissCta')}
          pending={startingNew}
          onConfirm={onStartNew}
        />
      ) : null}
    </View>
  );
}

function BusinessForm({
  verificationCase,
  onSaved,
}: {
  verificationCase: VerificationCase | null;
  onSaved: (verificationCase: VerificationCase) => void;
}) {
  const { t } = useTranslation();
  const inFlight = useRef(false);
  const [values, setValues] = useState<VerificationBusinessValues>(() =>
    valuesFromCase(verificationCase),
  );
  const [errors, setErrors] = useState<VerificationBusinessErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState<'caseStarted' | 'detailsSaved' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    if (inFlight.current) {
      return;
    }
    setSubmitError(null);
    setSaved(null);

    const payload = buildCasePayload(values);
    const parsed = CreateVerificationCaseRequestSchema.safeParse(payload);
    if (!parsed.success) {
      const next: VerificationBusinessErrors = {};
      for (const issue of parsed.error.issues) {
        const field = mapCaseIssuePath(issue.path);
        if (field) {
          next[field] = t('common.validation.invalid');
        }
      }
      setErrors(next);
      if (Object.keys(next).length === 0) {
        setSubmitError(t('mobile.studio.verification.errors.invalid'));
      }
      return;
    }

    setErrors({});
    inFlight.current = true;
    setIsSubmitting(true);
    try {
      const result = verificationCase
        ? await api.PATCH('/v1/me/verification-case', { body: payload })
        : await api.POST('/v1/me/verification-case', { body: payload });
      if (result.error) {
        setSubmitError(
          requestErrorMessage(
            scopedStudioTranslate(t, 'verification'),
            apiErrorWithStatus(result.error, result.response.status),
          ),
        );
        return;
      }
      setSaved(verificationCase ? 'detailsSaved' : 'caseStarted');
      onSaved(result.data);
    } catch {
      setSubmitError(t('mobile.studio.verification.errors.generic'));
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <View className="gap-4" testID="verification-business-form">
      <Text className="text-lg font-semibold text-foreground">
        {t('mobile.studio.verification.businessHeading')}
      </Text>
      {submitError ? (
        <FormNotice tone="error" testID="verification-details-error">
          {submitError}
        </FormNotice>
      ) : null}
      {saved ? (
        <FormNotice tone="success" testID="verification-details-saved">
          {t(`mobile.studio.verification.${saved}`)}
        </FormNotice>
      ) : null}
      {BUSINESS_FIELDS.map(([field, label]) => (
        <TextField
          key={field}
          testID={`verification-${field}`}
          label={t(`mobile.studio.verification.${label}`)}
          hint={
            field === 'businessName' ? t('mobile.studio.verification.businessNameHint') : undefined
          }
          value={values[field]}
          onChangeText={(text) => {
            setSaved(null);
            setValues((current) => ({ ...current, [field]: text }));
            setErrors((current) => ({ ...current, [field]: undefined }));
          }}
          error={errors[field]}
        />
      ))}
      <PrimaryButton
        testID="verification-save-details"
        label={t(
          isSubmitting
            ? 'mobile.studio.verification.saving'
            : verificationCase
              ? 'mobile.studio.verification.saveDetailsCta'
              : 'mobile.studio.verification.startCaseCta',
        )}
        loading={isSubmitting}
        onPress={() => void handleSubmit()}
      />
    </View>
  );
}

function VerificationManager({
  requirements,
  verificationCase,
  onCaseChanged,
  onDocumentAttached,
}: {
  requirements: RequiredDocument[];
  verificationCase: VerificationCase | null;
  onCaseChanged: (verificationCase: VerificationCase) => void;
  onDocumentAttached: (document: VerificationDocument) => void;
}) {
  const { t } = useTranslation();
  const submitInFlight = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [startingNew, setStartingNew] = useState(false);
  const [startNewError, setStartNewError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const translate = scopedStudioTranslate(t, 'verification');

  const uploads = useVerificationUploads(onDocumentAttached);
  const isDraft = verificationCase?.status === 'draft';
  const canSubmit = verificationCase
    ? canSubmitVerificationCase(verificationCase, requirements)
    : false;

  async function handleSubmit() {
    if (submitInFlight.current) {
      return;
    }
    submitInFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.POST('/v1/me/verification-case/submit');
      if (result.error) {
        setSubmitError(
          requestErrorMessage(translate, apiErrorWithStatus(result.error, result.response.status)),
        );
        return;
      }
      onCaseChanged(result.data);
    } catch {
      setSubmitError(t('mobile.studio.verification.errors.generic'));
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }

  async function handleStartNew() {
    setStartingNew(true);
    setStartNewError(null);
    try {
      const result = await api.POST('/v1/me/verification-case', { body: {} });
      if (result.error) {
        setStartNewError(
          requestErrorMessage(translate, apiErrorWithStatus(result.error, result.response.status)),
        );
        return;
      }
      setFormKey((current) => current + 1);
      onCaseChanged(result.data);
    } catch {
      setStartNewError(t('mobile.studio.verification.errors.generic'));
    } finally {
      setStartingNew(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerClassName="gap-6 px-6 pb-12"
        keyboardShouldPersistTaps="handled"
        testID="verification-manager"
      >
        <Text className="text-muted-foreground">{t('mobile.studio.verification.intro')}</Text>
        {verificationCase ? (
          <CaseStatus
            verificationCase={verificationCase}
            onStartNew={handleStartNew}
            startingNew={startingNew}
          />
        ) : null}
        {startNewError ? (
          <FormNotice tone="error" testID="verification-start-new-error">
            {startNewError}
          </FormNotice>
        ) : null}

        {verificationCase === null || isDraft ? (
          <BusinessForm key={formKey} verificationCase={verificationCase} onSaved={onCaseChanged} />
        ) : null}

        <View className="gap-3">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.studio.verification.documentsHeading')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.studio.verification.documentsHint')}
          </Text>
          <Text className="text-sm text-muted-foreground" testID="verification-photo-notice">
            {t('mobile.studio.verification.photoNotice')}
          </Text>
          {verificationCase ? (
            requirements.map((requirement) => (
              <VerificationSlot
                key={requirement.key}
                requirement={requirement}
                document={findDocumentForKey(verificationCase.documents, requirement.key)}
                entry={uploads.entries[requirement.key]}
                readOnly={!isDraft}
                onPicked={(file) => {
                  uploads.start(requirement, file);
                }}
                onRetry={() => {
                  uploads.retry(requirement);
                }}
                onDismiss={() => {
                  uploads.dismiss(requirement.key);
                }}
              />
            ))
          ) : (
            <FormNotice tone="info" testID="verification-needs-case">
              {t('mobile.studio.verification.documentsNeedCase')}
            </FormNotice>
          )}
        </View>

        {isDraft ? (
          <View className="gap-3">
            <Text className="text-lg font-semibold text-foreground">
              {t('mobile.studio.verification.submitHeading')}
            </Text>
            {canSubmit ? null : (
              <Text className="text-sm text-muted-foreground" testID="verification-submit-hint">
                {t('mobile.studio.verification.submitRequirementsHint')}
              </Text>
            )}
            {submitError ? (
              <FormNotice tone="error" testID="verification-submit-error">
                {submitError}
              </FormNotice>
            ) : null}
            <ConfirmAction
              testID="verification-submit"
              triggerLabel={t('mobile.studio.verification.submitCta')}
              title={t('mobile.studio.verification.submitConfirmTitle')}
              description={t('mobile.studio.verification.submitConfirmDescription')}
              confirmLabel={t('mobile.studio.verification.submitConfirmCta')}
              pendingLabel={t('mobile.studio.verification.submitPending')}
              dismissLabel={t('mobile.studio.verification.submitDismissCta')}
              disabled={!canSubmit}
              pending={submitting}
              onConfirm={handleSubmit}
            />
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function VerificationContent() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, reload, replaceCase, attachDocument } = useVerificationCase();

  if (state.status === 'loading') {
    return <StudioLoading testID="verification-loading" />;
  }
  if (state.status === 'unauthorized') {
    return (
      <StudioMessage
        testID="verification-unauthorized"
        message={t('mobile.studio.sessionExpired')}
      />
    );
  }
  if (state.status === 'error') {
    return (
      <StudioMessage
        testID="verification-load-error"
        message={t('mobile.studio.loadFailed')}
        actionLabel={t('mobile.studio.retry')}
        actionTestID="verification-retry"
        onAction={reload}
      />
    );
  }
  if (state.status === 'missingProfile') {
    return (
      <StudioMessage
        testID="verification-needs-profile"
        tone="info"
        message={`${t('mobile.studio.verification.needsProfileTitle')}. ${t('mobile.studio.verification.needsProfileDescription')}`}
        actionLabel={t('mobile.studio.verification.needsProfileCta')}
        actionTestID="verification-create-profile"
        onAction={() => {
          router.push('/studio/profile');
        }}
      />
    );
  }
  if (state.status === 'countryUnavailable') {
    return (
      <StudioMessage
        testID="verification-country-unavailable"
        tone="info"
        message={t('mobile.studio.verification.countryUnavailable')}
      />
    );
  }

  return (
    <VerificationManager
      requirements={state.requirements}
      verificationCase={state.verificationCase}
      onCaseChanged={replaceCase}
      onDocumentAttached={attachDocument}
    />
  );
}

export default function StudioVerificationScreen() {
  const { t } = useTranslation();

  return (
    <StudioFrame title={t('mobile.studio.verification.title')}>
      <VerificationContent />
    </StudioFrame>
  );
}
