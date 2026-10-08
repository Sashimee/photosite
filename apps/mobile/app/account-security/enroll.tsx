import { TotpEnrollRequestSchema, TotpVerifyRequestSchema } from '@photoo/shared';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Text, View } from 'react-native';

import { CopyButton } from '../../src/components/account/copy-button';
import { AuthScreenLayout } from '../../src/components/auth-screen-layout';
import { FormNotice } from '../../src/components/form/form-notice';
import { PrimaryButton } from '../../src/components/form/primary-button';
import { TextField } from '../../src/components/form/text-field';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth-context';
import { fieldErrorMessages } from '../../src/lib/form-errors';
import { registerPushDevice } from '../../src/lib/push';
import { twoFactorErrorMessage } from '../../src/lib/two-factor-errors';

interface Enrollment {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

type Step = { name: 'password' } | { name: 'secret'; enrollment: Enrollment } | { name: 'code' };

export default function EnrollTwoFactorScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { updateUser, replaceSession, signOut } = useAuth();
  const inFlight = useRef(false);
  const [step, setStep] = useState<Step>({ name: 'password' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function startEnrollment() {
    if (inFlight.current) {
      return;
    }
    const parsed = TotpEnrollRequestSchema.safeParse({ password });
    if (!parsed.success) {
      setFieldErrors(fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error));
      return;
    }

    inFlight.current = true;
    setFieldErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const { data, error } = await api.POST('/v1/auth/totp/enroll', { body: parsed.data });
      if (error) {
        setSubmitError(twoFactorErrorMessage(t, error));
        return;
      }
      setPassword('');
      setStep({ name: 'secret', enrollment: data });
    } catch {
      setSubmitError(t('mobile.auth.errors.generic'));
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  }

  async function openAuthenticator(otpauthUrl: string) {
    setOpenFailed(false);
    try {
      await Linking.openURL(otpauthUrl);
    } catch {
      setOpenFailed(true);
    }
  }

  async function verify() {
    if (inFlight.current) {
      return;
    }
    const parsed = TotpVerifyRequestSchema.safeParse({ code });
    if (!parsed.success) {
      setFieldErrors(fieldErrorMessages((key) => t(`common.validation.${key}`), parsed.error));
      return;
    }

    inFlight.current = true;
    setFieldErrors({});
    setSubmitError(null);
    setIsSubmitting(true);
    let sessionRotated = false;
    try {
      const { data, error } = await api.POST('/v1/auth/totp/verify', { body: parsed.data });
      if (error) {
        setSubmitError(twoFactorErrorMessage(t, error));
        return;
      }
      if (data.session) {
        sessionRotated = true;
        await replaceSession(data.session);
        sessionRotated = false;
      }
      updateUser(data.user);
      await registerPushDevice();
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/account');
      }
    } catch {
      if (sessionRotated) {
        await signOut();
        return;
      }
      setSubmitError(t('mobile.auth.errors.generic'));
    } finally {
      inFlight.current = false;
      setIsSubmitting(false);
    }
  }

  if (step.name === 'password') {
    return (
      <AuthScreenLayout>
        <Text className="text-2xl font-semibold text-foreground">
          {t('mobile.account.twoFactor.enroll.title')}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {t('mobile.account.twoFactor.enroll.passwordDescription')}
        </Text>
        {submitError ? (
          <FormNotice tone="error" testID="two-factor-enroll-error">
            {submitError}
          </FormNotice>
        ) : null}
        <TextField
          testID="two-factor-enroll-password"
          label={t('mobile.account.twoFactor.enroll.passwordLabel')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          autoCapitalize="none"
          error={fieldErrors.password}
        />
        <PrimaryButton
          testID="two-factor-enroll-password-submit"
          label={t('mobile.account.twoFactor.enroll.passwordSubmit')}
          onPress={() => void startEnrollment()}
          loading={isSubmitting}
        />
      </AuthScreenLayout>
    );
  }

  if (step.name === 'secret') {
    const { secret, otpauthUrl, backupCodes } = step.enrollment;
    return (
      <AuthScreenLayout>
        <Text className="text-2xl font-semibold text-foreground">
          {t('mobile.account.twoFactor.enroll.secretTitle')}
        </Text>
        <Text className="text-sm text-muted-foreground">
          {t('mobile.account.twoFactor.enroll.secretDescription')}
        </Text>
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">
            {t('mobile.account.twoFactor.enroll.secretLabel')}
          </Text>
          <Text
            selectable
            className="rounded-md border border-border bg-muted p-3 font-mono text-base text-foreground"
            testID="two-factor-enroll-secret"
          >
            {secret}
          </Text>
          <CopyButton
            testID="two-factor-enroll-copy-secret"
            label={t('mobile.account.twoFactor.enroll.copySecret')}
            value={secret}
          />
          <PrimaryButton
            testID="two-factor-enroll-open"
            label={t('mobile.account.twoFactor.enroll.openAuthenticator')}
            onPress={() => void openAuthenticator(otpauthUrl)}
          />
          {openFailed ? (
            <FormNotice tone="info" testID="two-factor-enroll-open-failed">
              {t('mobile.account.twoFactor.enroll.openAuthenticatorFailed')}
            </FormNotice>
          ) : null}
        </View>
        <View className="gap-2">
          <Text className="text-lg font-semibold text-foreground">
            {t('mobile.account.twoFactor.enroll.backupCodesTitle')}
          </Text>
          <Text className="text-sm text-muted-foreground">
            {t('mobile.account.twoFactor.enroll.backupCodesDescription')}
          </Text>
          <Text
            selectable
            className="rounded-md border border-border bg-muted p-3 font-mono text-base text-foreground"
            testID="two-factor-enroll-backup-codes"
          >
            {backupCodes.join('\n')}
          </Text>
          <CopyButton
            testID="two-factor-enroll-copy-backup-codes"
            label={t('mobile.account.twoFactor.enroll.copyBackupCodes')}
            value={backupCodes.join('\n')}
          />
        </View>
        <PrimaryButton
          testID="two-factor-enroll-stored"
          label={t('mobile.account.twoFactor.enroll.stored')}
          onPress={() => {
            setOpenFailed(false);
            setStep({ name: 'code' });
          }}
        />
      </AuthScreenLayout>
    );
  }

  return (
    <AuthScreenLayout>
      <Text className="text-2xl font-semibold text-foreground">
        {t('mobile.account.twoFactor.enroll.codeTitle')}
      </Text>
      <Text className="text-sm text-muted-foreground">
        {t('mobile.account.twoFactor.enroll.codeDescription')}
      </Text>
      {submitError ? (
        <FormNotice tone="error" testID="two-factor-enroll-error">
          {submitError}
        </FormNotice>
      ) : null}
      <TextField
        testID="two-factor-enroll-code"
        label={t('mobile.account.twoFactor.enroll.codeLabel')}
        value={code}
        onChangeText={setCode}
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        error={fieldErrors.code}
      />
      <PrimaryButton
        testID="two-factor-enroll-code-submit"
        label={t('mobile.account.twoFactor.enroll.codeSubmit')}
        onPress={() => void verify()}
        loading={isSubmitting}
      />
    </AuthScreenLayout>
  );
}
