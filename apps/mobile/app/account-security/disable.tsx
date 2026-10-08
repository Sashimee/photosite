import { TotpDisableRequestSchema } from '@photoo/shared';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { AuthScreenLayout } from '../../src/components/auth-screen-layout';
import { FormNotice } from '../../src/components/form/form-notice';
import { PrimaryButton } from '../../src/components/form/primary-button';
import { TextField } from '../../src/components/form/text-field';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth-context';
import { fieldErrorMessages } from '../../src/lib/form-errors';
import { twoFactorErrorMessage } from '../../src/lib/two-factor-errors';

export default function DisableTwoFactorScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { updateUser } = useAuth();
  const inFlight = useRef(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    if (inFlight.current) {
      return;
    }
    const parsed = TotpDisableRequestSchema.safeParse({ code, password });
    if (!parsed.success) {
      setFieldErrors(fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error));
      return;
    }

    inFlight.current = true;
    setFieldErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const { data, error } = await api.POST('/v1/auth/totp/disable', { body: parsed.data });
      if (error) {
        setSubmitError(twoFactorErrorMessage(t, error));
        return;
      }
      updateUser(data.user);
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/account');
      }
    } catch {
      setSubmitError(t('mobile.auth.errors.generic'));
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <AuthScreenLayout>
      <Text className="text-2xl font-semibold text-foreground">
        {t('mobile.account.twoFactor.disable.title')}
      </Text>
      <Text className="text-sm text-muted-foreground">
        {t('mobile.account.twoFactor.disable.description')}
      </Text>
      {submitError ? (
        <FormNotice tone="error" testID="two-factor-disable-error">
          {submitError}
        </FormNotice>
      ) : null}
      <TextField
        testID="two-factor-disable-code"
        label={t('mobile.account.twoFactor.disable.codeLabel')}
        value={code}
        onChangeText={setCode}
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        error={fieldErrors.code}
      />
      <TextField
        testID="two-factor-disable-password"
        label={t('mobile.account.twoFactor.disable.passwordLabel')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        autoCapitalize="none"
        error={fieldErrors.password}
      />
      <PrimaryButton
        testID="two-factor-disable-submit"
        label={t('mobile.account.twoFactor.disable.submit')}
        onPress={() => void handleSubmit()}
        loading={isSubmitting}
      />
    </AuthScreenLayout>
  );
}
