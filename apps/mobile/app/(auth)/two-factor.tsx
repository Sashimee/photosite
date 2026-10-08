import { SignInTotpRequestSchema } from '@photoo/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text } from 'react-native';

import { AuthScreenLayout } from '../../src/components/auth-screen-layout';
import { FormNotice } from '../../src/components/form/form-notice';
import { PrimaryButton } from '../../src/components/form/primary-button';
import { TextField } from '../../src/components/form/text-field';
import { api } from '../../src/lib/api';
import { authErrorMessage, scopedAuthTranslate } from '../../src/lib/auth-errors';
import { useAuth } from '../../src/lib/auth-context';
import { fieldErrorMessages } from '../../src/lib/form-errors';
import { clearTwoFactorChallenge, getTwoFactorChallenge } from '../../src/lib/two-factor-challenge';

const DEAD_CHALLENGE_CODES = new Set([
  'INVALID_TWO_FACTOR_COOKIE',
  'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE',
]);

type Mode = 'code' | 'backupCode';

export default function TwoFactorScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signIn } = useAuth();
  const [mode, setMode] = useState<Mode>('code');
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function restartSignIn() {
    clearTwoFactorChallenge();
    router.replace({ pathname: '/sign-in', params: { reason: 'challenge-expired' } });
  }

  useEffect(() => {
    if (!getTwoFactorChallenge()) {
      restartSignIn();
    }
  }, []);

  function toggleMode() {
    setFieldErrors({});
    setCode('');
    setBackupCode('');
    setMode((current) => (current === 'code' ? 'backupCode' : 'code'));
  }

  async function handleSubmit() {
    const challengeToken = getTwoFactorChallenge();
    if (!challengeToken) {
      restartSignIn();
      return;
    }

    const body = mode === 'code' ? { code, challengeToken } : { backupCode, challengeToken };
    const parsed = SignInTotpRequestSchema.safeParse(body);
    if (!parsed.success) {
      setFieldErrors(fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error));
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    // `body` (not `parsed.data`) so the request never carries an explicit
    // `undefined` for the field the other mode would have used.
    const { data, error } = await api.POST('/v1/auth/sign-in/totp', { body });
    setIsSubmitting(false);

    if (error) {
      if (error.code && DEAD_CHALLENGE_CODES.has(error.code)) {
        restartSignIn();
        return;
      }
      setSubmitError(authErrorMessage(scopedAuthTranslate(t), error));
      return;
    }

    clearTwoFactorChallenge();
    await signIn(data.user, data.session);
  }

  return (
    <AuthScreenLayout>
      <Text className="text-2xl font-semibold text-foreground">
        {t('mobile.auth.twoFactor.title')}
      </Text>
      <Text className="text-sm text-muted-foreground">
        {t('mobile.auth.twoFactor.description')}
      </Text>
      {submitError ? (
        <FormNotice tone="error" testID="two-factor-error">
          {submitError}
        </FormNotice>
      ) : null}
      {mode === 'code' ? (
        <TextField
          testID="two-factor-code"
          label={t('mobile.auth.twoFactor.codeLabel')}
          value={code}
          onChangeText={setCode}
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          error={fieldErrors.code}
        />
      ) : (
        <TextField
          testID="two-factor-backup-code"
          label={t('mobile.auth.twoFactor.backupCodeLabel')}
          value={backupCode}
          onChangeText={setBackupCode}
          autoComplete="off"
          autoCapitalize="none"
          error={fieldErrors.backupCode}
        />
      )}
      <Pressable onPress={toggleMode} testID="two-factor-toggle-mode">
        <Text className="text-sm font-medium text-foreground underline">
          {mode === 'code'
            ? t('mobile.auth.twoFactor.useBackupCode')
            : t('mobile.auth.twoFactor.useAuthenticatorCode')}
        </Text>
      </Pressable>
      <PrimaryButton
        testID="two-factor-submit"
        label={t('mobile.auth.twoFactor.submit')}
        onPress={() => void handleSubmit()}
        loading={isSubmitting}
      />
    </AuthScreenLayout>
  );
}
