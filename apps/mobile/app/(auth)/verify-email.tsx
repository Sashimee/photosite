import { VerifyEmailRequestSchema } from '@photoo/shared';
import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { AuthScreenLayout } from '../../src/components/auth-screen-layout';
import { FormNotice } from '../../src/components/form/form-notice';
import { PrimaryButton } from '../../src/components/form/primary-button';
import { TextField } from '../../src/components/form/text-field';
import { api } from '../../src/lib/api';
import { authErrorMessage, scopedAuthTranslate } from '../../src/lib/auth-errors';
import { useAuth } from '../../src/lib/auth-context';
import { fieldErrorMessages } from '../../src/lib/form-errors';

export default function VerifyEmailScreen() {
  const { t } = useTranslation();
  const { checkSession } = useAuth();
  const [token, setToken] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [verified, setVerified] = useState(false);

  async function handleContinue() {
    setNotice(null);
    setIsChecking(true);
    const signedIn = await checkSession();
    setIsChecking(false);
    if (!signedIn) {
      setNotice(t('mobile.auth.verifyEmail.notVerifiedYet'));
    }
  }

  async function handleTokenSubmit() {
    const parsed = VerifyEmailRequestSchema.safeParse({ token });
    if (!parsed.success) {
      setFieldErrors(fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error));
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    const { error } = await api.POST('/v1/auth/verify-email', { body: parsed.data });
    setIsSubmitting(false);

    if (error) {
      setSubmitError(authErrorMessage(scopedAuthTranslate(t), error));
      return;
    }

    setVerified(true);
  }

  return (
    <AuthScreenLayout>
      <Text className="text-2xl font-semibold text-foreground">
        {t('mobile.auth.verifyEmail.title')}
      </Text>
      {verified ? (
        <FormNotice tone="success" testID="verify-email-success">
          {t('mobile.auth.verifyEmail.success')}{' '}
          <Link href="/sign-in">
            <Text className="font-medium underline">{t('mobile.auth.verifyEmail.signInLink')}</Text>
          </Link>
        </FormNotice>
      ) : (
        <>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.auth.verifyEmail.description')}
          </Text>
          {notice ? (
            <FormNotice tone="info" testID="verify-email-notice">
              {notice}
            </FormNotice>
          ) : null}
          {submitError ? (
            <FormNotice tone="error" testID="verify-email-error">
              {submitError}
            </FormNotice>
          ) : null}
          <PrimaryButton
            testID="verify-email-continue"
            label={t('mobile.auth.verifyEmail.continue')}
            onPress={() => void handleContinue()}
            loading={isChecking}
          />
          <TextField
            testID="verify-email-token"
            label={t('mobile.auth.verifyEmail.tokenLabel')}
            hint={t('mobile.auth.verifyEmail.tokenHint')}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            error={fieldErrors.token}
          />
          <PrimaryButton
            testID="verify-email-token-submit"
            label={t('mobile.auth.verifyEmail.tokenSubmit')}
            onPress={() => void handleTokenSubmit()}
            loading={isSubmitting}
          />
        </>
      )}
    </AuthScreenLayout>
  );
}
