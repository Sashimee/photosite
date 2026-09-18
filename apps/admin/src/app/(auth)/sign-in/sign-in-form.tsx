'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import {
  SignInRequestSchema,
  SignInTotpRequestSchema,
  TotpEnrollRequestSchema,
  TotpVerifyRequestSchema,
} from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';
import { fieldErrorMessage } from '@/lib/form-errors';
import { sanitizeNextPath } from '@/lib/next-param';

type Stage = 'password' | 'code' | 'reverify-code' | 'enroll-password' | 'enroll-verify';

export type SignInInitialMode = 'signIn' | 'reverify' | 'enroll';

interface EnrollmentData {
  secret: string;
  backupCodes: string[];
}

function initialStageFor(mode: SignInInitialMode): Stage {
  if (mode === 'reverify') {
    return 'reverify-code';
  }
  if (mode === 'enroll') {
    return 'enroll-password';
  }
  return 'password';
}

export function SignInForm({
  initialMode,
  next,
}: {
  initialMode: SignInInitialMode;
  next?: string | undefined;
}) {
  const t = useTranslations('admin.signIn');
  const tErrors = useTranslations('admin.signIn');
  const tValidation = useTranslations('common.validation');
  const router = useRouter();

  const [stage, setStage] = useState<Stage>(initialStageFor(initialMode));
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null);
  const [savedBackupCodes, setSavedBackupCodes] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const passwordForm = useForm<z.infer<typeof SignInRequestSchema>>({
    resolver: zodResolver(SignInRequestSchema),
    defaultValues: { email: '', password: '' },
  });
  const codeForm = useForm<z.infer<typeof SignInTotpRequestSchema>>({
    resolver: zodResolver(SignInTotpRequestSchema),
    shouldUnregister: true,
  });
  const [useBackupCode, setUseBackupCode] = useState(false);
  const reverifyForm = useForm<{ code: string }>({
    resolver: zodResolver(TotpVerifyRequestSchema),
    defaultValues: { code: '' },
  });
  const enrollPasswordForm = useForm<{ password: string }>({
    resolver: zodResolver(TotpEnrollRequestSchema),
    defaultValues: { password: '' },
  });
  const enrollVerifyForm = useForm<{ code: string }>({
    resolver: zodResolver(TotpVerifyRequestSchema),
    defaultValues: { code: '' },
  });

  function goToDestination() {
    router.refresh();
    router.push(sanitizeNextPath(next, '/'));
  }

  async function onPasswordSubmit(values: z.infer<typeof SignInRequestSchema>) {
    setSubmitError(null);
    const { data, error } = await api.POST('/v1/auth/sign-in', { body: values });
    if (error) {
      setSubmitError(authErrorMessage(tErrors, error));
      return;
    }
    if ('twoFactorRequired' in data) {
      setStage('code');
      return;
    }
    if (!data.user.roles.includes('admin')) {
      goToDestination();
      return;
    }
    if (!data.user.twoFactorEnabled) {
      setStage('enroll-password');
      return;
    }
    goToDestination();
  }

  async function onCodeSubmit(values: z.infer<typeof SignInTotpRequestSchema>) {
    setSubmitError(null);
    const body = values.code ? { code: values.code } : { backupCode: values.backupCode ?? '' };
    const { error } = await api.POST('/v1/auth/sign-in/totp', { body });
    if (error) {
      setSubmitError(authErrorMessage(tErrors, error));
      return;
    }
    goToDestination();
  }

  async function onReverifySubmit(values: { code: string }) {
    setSubmitError(null);
    const { error } = await api.POST('/v1/auth/totp/verify', { body: values });
    if (error) {
      setSubmitError(authErrorMessage(tErrors, error));
      return;
    }
    goToDestination();
  }

  async function onEnrollPasswordSubmit(values: { password: string }) {
    setSubmitError(null);
    const { data, error } = await api.POST('/v1/auth/totp/enroll', { body: values });
    if (error) {
      setSubmitError(authErrorMessage(tErrors, error));
      return;
    }
    setEnrollment({ secret: data.secret, backupCodes: data.backupCodes });
    setSavedBackupCodes(false);
    setStage('enroll-verify');
  }

  async function onEnrollVerifySubmit(values: { code: string }) {
    setSubmitError(null);
    const { error } = await api.POST('/v1/auth/totp/verify', { body: values });
    if (error) {
      setSubmitError(authErrorMessage(tErrors, error));
      return;
    }
    goToDestination();
  }

  const STAGE_TITLES: Record<Stage, string> = {
    password: t('title'),
    code: t('twoFactor.title'),
    'reverify-code': t('reverify.title'),
    'enroll-password': t('enroll.passwordTitle'),
    'enroll-verify': t('enroll.passwordTitle'),
  };

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold text-foreground">{STAGE_TITLES[stage]}</h1>
      {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}

      {stage === 'password' ? (
        <form
          noValidate
          onSubmit={(event) => void passwordForm.handleSubmit(onPasswordSubmit)(event)}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sign-in-email">{t('emailLabel')}</Label>
            <Input
              id="sign-in-email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(passwordForm.formState.errors.email)}
              aria-describedby={
                passwordForm.formState.errors.email ? 'sign-in-email-error' : undefined
              }
              {...passwordForm.register('email')}
            />
            <FieldError
              id="sign-in-email-error"
              message={fieldErrorMessage(tValidation, passwordForm.formState.errors.email)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sign-in-password">{t('passwordLabel')}</Label>
            <Input
              id="sign-in-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(passwordForm.formState.errors.password)}
              aria-describedby={
                passwordForm.formState.errors.password ? 'sign-in-password-error' : undefined
              }
              {...passwordForm.register('password')}
            />
            <FieldError
              id="sign-in-password-error"
              message={fieldErrorMessage(tValidation, passwordForm.formState.errors.password)}
            />
          </div>
          <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
            {t('submit')}
          </Button>
        </form>
      ) : null}

      {stage === 'code' ? (
        <form
          noValidate
          onSubmit={(event) => void codeForm.handleSubmit(onCodeSubmit)(event)}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-muted-foreground">{t('twoFactor.description')}</p>
          {useBackupCode ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sign-in-backup-code">{t('twoFactor.backupCodeLabel')}</Label>
              <Input
                id="sign-in-backup-code"
                type="text"
                autoComplete="off"
                aria-invalid={Boolean(codeForm.formState.errors.backupCode)}
                {...codeForm.register('backupCode')}
              />
              <FieldError
                id="sign-in-backup-code-error"
                message={fieldErrorMessage(tValidation, codeForm.formState.errors.backupCode)}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sign-in-code">{t('twoFactor.codeLabel')}</Label>
              <Input
                id="sign-in-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                aria-invalid={Boolean(codeForm.formState.errors.code)}
                {...codeForm.register('code')}
              />
              <FieldError
                id="sign-in-code-error"
                message={fieldErrorMessage(tValidation, codeForm.formState.errors.code)}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              codeForm.resetField(useBackupCode ? 'backupCode' : 'code');
              setUseBackupCode(!useBackupCode);
            }}
            className="self-start text-sm font-medium text-foreground underline"
          >
            {useBackupCode ? t('twoFactor.useAuthenticatorCode') : t('twoFactor.useBackupCode')}
          </button>
          <Button type="submit" disabled={codeForm.formState.isSubmitting}>
            {t('twoFactor.submit')}
          </Button>
        </form>
      ) : null}

      {stage === 'reverify-code' ? (
        <form
          noValidate
          onSubmit={(event) => void reverifyForm.handleSubmit(onReverifySubmit)(event)}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-muted-foreground">{t('reverify.description')}</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reverify-code">{t('reverify.codeLabel')}</Label>
            <Input
              id="reverify-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              aria-invalid={Boolean(reverifyForm.formState.errors.code)}
              {...reverifyForm.register('code')}
            />
            <FieldError
              id="reverify-code-error"
              message={fieldErrorMessage(tValidation, reverifyForm.formState.errors.code)}
            />
          </div>
          <Button type="submit" disabled={reverifyForm.formState.isSubmitting}>
            {t('reverify.submit')}
          </Button>
        </form>
      ) : null}

      {stage === 'enroll-password' ? (
        <form
          noValidate
          onSubmit={(event) => void enrollPasswordForm.handleSubmit(onEnrollPasswordSubmit)(event)}
          className="flex flex-col gap-4"
        >
          <p className="text-sm text-muted-foreground">{t('enroll.passwordDescription')}</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="enroll-password">{t('enroll.passwordLabel')}</Label>
            <Input
              id="enroll-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(enrollPasswordForm.formState.errors.password)}
              {...enrollPasswordForm.register('password')}
            />
            <FieldError
              id="enroll-password-error"
              message={fieldErrorMessage(tValidation, enrollPasswordForm.formState.errors.password)}
            />
          </div>
          <Button type="submit" disabled={enrollPasswordForm.formState.isSubmitting}>
            {t('enroll.startCta')}
          </Button>
        </form>
      ) : null}

      {stage === 'enroll-verify' && enrollment ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-sm font-semibold text-foreground">{t('enroll.scanTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('enroll.scanDescription')}</p>
            <Label htmlFor="totp-secret">{t('enroll.secretLabel')}</Label>
            <code
              id="totp-secret"
              className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
            >
              {enrollment.secret}
            </code>
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-sm font-semibold text-foreground">
              {t('enroll.backupCodesTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('enroll.backupCodesDescription')}</p>
            <ul className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-3 font-mono text-sm">
              {enrollment.backupCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={savedBackupCodes}
                onChange={(event) => {
                  setSavedBackupCodes(event.target.checked);
                }}
                className="size-4"
              />
              {t('enroll.backupCodesConfirm')}
            </label>
          </div>
          <form
            noValidate
            onSubmit={(event) => void enrollVerifyForm.handleSubmit(onEnrollVerifySubmit)(event)}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="enroll-verify-code">{t('enroll.verifyCodeLabel')}</Label>
              <Input
                id="enroll-verify-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                aria-invalid={Boolean(enrollVerifyForm.formState.errors.code)}
                {...enrollVerifyForm.register('code')}
              />
              <FieldError
                id="enroll-verify-code-error"
                message={fieldErrorMessage(tValidation, enrollVerifyForm.formState.errors.code)}
              />
            </div>
            <Button
              type="submit"
              disabled={!savedBackupCodes || enrollVerifyForm.formState.isSubmitting}
            >
              {t('enroll.verifyCta')}
            </Button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
