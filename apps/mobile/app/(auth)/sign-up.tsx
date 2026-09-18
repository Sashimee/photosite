import { SUPPORTED_LOCALES, SignUpRequestSchema, type Locale } from '@photoo/shared';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { AuthScreenLayout } from '../../src/components/auth-screen-layout';
import { FormNotice } from '../../src/components/form/form-notice';
import { PrimaryButton } from '../../src/components/form/primary-button';
import { TextField } from '../../src/components/form/text-field';
import { api } from '../../src/lib/api';
import { authErrorMessage, scopedAuthTranslate } from '../../src/lib/auth-errors';
import { fieldErrorMessages } from '../../src/lib/form-errors';
import { getDeviceLocale } from '../../src/lib/i18n';

const SIGN_UP_ROLE_OPTIONS = ['client', 'photographer'] as const;
type SignUpRole = (typeof SIGN_UP_ROLE_OPTIONS)[number];

export default function SignUpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<SignUpRole[]>([]);
  const [locale, setLocale] = useState<Locale>(() => getDeviceLocale());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleRole(role: SignUpRole) {
    setRoles((current) =>
      current.includes(role) ? current.filter((value) => value !== role) : [...current, role],
    );
  }

  async function handleSubmit() {
    const parsed = SignUpRequestSchema.safeParse({ email, password, roles, locale });
    if (!parsed.success) {
      setFieldErrors(fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error));
      return;
    }

    setFieldErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    // Built key-by-key rather than spread from `parsed.data`: there is no
    // consent banner in the app yet (1C.8), so `anonymousId` is never set,
    // and `exactOptionalPropertyTypes` rejects the schema's `T | undefined`
    // for it against the client's `T | omitted` optional field.
    const { error } = await api.POST('/v1/auth/sign-up', {
      body: {
        email: parsed.data.email,
        password: parsed.data.password,
        roles: parsed.data.roles,
        locale: parsed.data.locale,
      },
    });
    setIsSubmitting(false);

    if (error) {
      setSubmitError(authErrorMessage(scopedAuthTranslate(t), error));
      return;
    }

    router.push('/verify-email');
  }

  return (
    <AuthScreenLayout>
      <Text className="text-2xl font-semibold text-foreground">
        {t('mobile.auth.signUp.title')}
      </Text>
      {submitError ? (
        <FormNotice tone="error" testID="sign-up-error">
          {submitError}
        </FormNotice>
      ) : null}
      <TextField
        testID="sign-up-email"
        label={t('mobile.auth.signUp.emailLabel')}
        value={email}
        onChangeText={setEmail}
        autoComplete="email"
        textContentType="emailAddress"
        keyboardType="email-address"
        autoCapitalize="none"
        error={fieldErrors.email}
      />
      <TextField
        testID="sign-up-password"
        label={t('mobile.auth.signUp.passwordLabel')}
        hint={t('mobile.auth.signUp.passwordHint')}
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
        textContentType="newPassword"
        secureTextEntry
        error={fieldErrors.password}
      />
      <View className="gap-1.5">
        <Text className="text-sm font-medium text-foreground">
          {t('mobile.auth.signUp.roleLabel')}
        </Text>
        {SIGN_UP_ROLE_OPTIONS.map((role) => {
          const selected = roles.includes(role);
          return (
            <Pressable
              key={role}
              testID={`sign-up-role-${role}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() => {
                toggleRole(role);
              }}
              className="flex-row items-center gap-2 py-1"
            >
              <View
                className={`h-5 w-5 rounded border ${selected ? 'border-primary bg-primary' : 'border-input bg-background'}`}
              />
              <Text className="text-sm text-foreground">{t(`mobile.auth.roles.${role}`)}</Text>
            </Pressable>
          );
        })}
        {fieldErrors.roles ? (
          <Text className="text-sm text-destructive">{fieldErrors.roles}</Text>
        ) : null}
      </View>
      <View className="gap-1.5">
        <Text className="text-sm font-medium text-foreground">
          {t('mobile.auth.signUp.localeLabel')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {SUPPORTED_LOCALES.map((code) => {
            const selected = locale === code;
            return (
              <Pressable
                key={code}
                testID={`sign-up-locale-${code}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => {
                  setLocale(code);
                }}
                className={`rounded-md border px-3 py-1.5 ${selected ? 'border-primary bg-primary' : 'border-input bg-background'}`}
              >
                <Text className={selected ? 'text-primary-foreground' : 'text-foreground'}>
                  {t(`locale.${code}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <PrimaryButton
        testID="sign-up-submit"
        label={t('mobile.auth.signUp.submit')}
        onPress={() => void handleSubmit()}
        loading={isSubmitting}
      />
      <Text className="text-sm text-muted-foreground">
        {t('mobile.auth.signUp.alreadyHaveAccount')}{' '}
        <Link href="/sign-in">
          <Text className="font-medium text-foreground underline">
            {t('mobile.auth.signUp.signInLink')}
          </Text>
        </Link>
      </Text>
    </AuthScreenLayout>
  );
}
