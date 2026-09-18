import { ConfirmPasswordResetRequestSchema } from '@photoo/shared';
import { Link, useLocalSearchParams } from 'expo-router';
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

export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ token?: string }>();
  const [token, setToken] = useState(params.token ?? '');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    const parsed = ConfirmPasswordResetRequestSchema.safeParse({ token, password });
    if (!parsed.success) {
      setFieldErrors(fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error));
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    const { error } = await api.POST('/v1/auth/password-reset/confirm', { body: parsed.data });
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
        {t('mobile.auth.resetPassword.title')}
      </Text>
      {success ? (
        <FormNotice tone="success" testID="reset-password-success">
          {t('mobile.auth.resetPassword.success')}{' '}
          <Link href="/sign-in">
            <Text className="font-medium underline">
              {t('mobile.auth.resetPassword.signInLink')}
            </Text>
          </Link>
        </FormNotice>
      ) : (
        <>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.auth.resetPassword.description')}
          </Text>
          {submitError ? (
            <FormNotice tone="error" testID="reset-password-error">
              {submitError}
            </FormNotice>
          ) : null}
          <TextField
            testID="reset-password-token"
            label={t('mobile.auth.resetPassword.tokenLabel')}
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            error={fieldErrors.token}
          />
          <TextField
            testID="reset-password-password"
            label={t('mobile.auth.resetPassword.passwordLabel')}
            hint={t('mobile.auth.resetPassword.passwordHint')}
            value={password}
            onChangeText={setPassword}
            autoComplete="new-password"
            textContentType="newPassword"
            secureTextEntry
            error={fieldErrors.password}
          />
          <PrimaryButton
            testID="reset-password-submit"
            label={t('mobile.auth.resetPassword.submit')}
            onPress={() => void handleSubmit()}
            loading={isSubmitting}
          />
        </>
      )}
    </AuthScreenLayout>
  );
}
