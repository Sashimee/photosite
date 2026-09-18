import { SignInRequestSchema } from '@photoo/shared';
import { Link, useRouter } from 'expo-router';
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

export default function SignInScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    const parsed = SignInRequestSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error));
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    const { data, error } = await api.POST('/v1/auth/sign-in', { body: parsed.data });
    setIsSubmitting(false);

    if (error) {
      setSubmitError(authErrorMessage(scopedAuthTranslate(t), error));
      return;
    }

    if ('twoFactorRequired' in data) {
      router.push('/two-factor');
      return;
    }

    await signIn(data.user, data.session);
  }

  return (
    <AuthScreenLayout>
      <Text className="text-2xl font-semibold text-foreground">
        {t('mobile.auth.signIn.title')}
      </Text>
      {submitError ? (
        <FormNotice tone="error" testID="sign-in-error">
          {submitError}
        </FormNotice>
      ) : null}
      <TextField
        testID="sign-in-email"
        label={t('mobile.auth.signIn.emailLabel')}
        value={email}
        onChangeText={setEmail}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
        error={fieldErrors.email}
      />
      <TextField
        testID="sign-in-password"
        label={t('mobile.auth.signIn.passwordLabel')}
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        secureTextEntry
        error={fieldErrors.password}
      />
      <Link href="/forgot-password">
        <Text className="text-sm font-medium text-foreground underline">
          {t('mobile.auth.signIn.forgotPassword')}
        </Text>
      </Link>
      <PrimaryButton
        testID="sign-in-submit"
        label={t('mobile.auth.signIn.submit')}
        onPress={() => void handleSubmit()}
        loading={isSubmitting}
      />
      <Text className="text-sm text-muted-foreground">
        {t('mobile.auth.signIn.noAccount')}{' '}
        <Link href="/sign-up">
          <Text className="font-medium text-foreground underline">
            {t('mobile.auth.signIn.signUpLink')}
          </Text>
        </Link>
      </Text>
    </AuthScreenLayout>
  );
}
