import { RequestPasswordResetRequestSchema } from '@photoo/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { AuthScreenLayout } from '../../src/components/auth-screen-layout';
import { FormNotice } from '../../src/components/form/form-notice';
import { PrimaryButton } from '../../src/components/form/primary-button';
import { TextField } from '../../src/components/form/text-field';
import { api } from '../../src/lib/api';
import { authErrorMessage, scopedAuthTranslate } from '../../src/lib/auth-errors';
import { fieldErrorMessages } from '../../src/lib/form-errors';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    const parsed = RequestPasswordResetRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldErrors(fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error));
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    const { error } = await api.POST('/v1/auth/password-reset/request', { body: parsed.data });
    setIsSubmitting(false);

    if (error) {
      setSubmitError(authErrorMessage(scopedAuthTranslate(t), error));
      return;
    }

    setSuccess(true);
  }

  return (
    <AuthScreenLayout>
      <Text className="text-2xl font-semibold text-foreground">
        {t('mobile.auth.forgotPassword.title')}
      </Text>
      <Text className="text-sm text-muted-foreground">
        {t('mobile.auth.forgotPassword.description')}
      </Text>
      {success ? (
        <FormNotice tone="success" testID="forgot-password-success">
          {t('mobile.auth.forgotPassword.success')}
        </FormNotice>
      ) : (
        <>
          {submitError ? (
            <FormNotice tone="error" testID="forgot-password-error">
              {submitError}
            </FormNotice>
          ) : null}
          <TextField
            testID="forgot-password-email"
            label={t('mobile.auth.forgotPassword.emailLabel')}
            value={email}
            onChangeText={setEmail}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            autoCapitalize="none"
            error={fieldErrors.email}
          />
          <PrimaryButton
            testID="forgot-password-submit"
            label={t('mobile.auth.forgotPassword.submit')}
            onPress={() => void handleSubmit()}
            loading={isSubmitting}
          />
        </>
      )}
    </AuthScreenLayout>
  );
}
