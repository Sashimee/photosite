'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import {
  TotpDisableRequestSchema,
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

type Stage = 'idle' | 'enroll-password' | 'enroll-verify' | 'enabled' | 'disable';

interface EnrollmentData {
  secret: string;
  otpauthUrl: string;
  backupCodes: string[];
}

export function TwoFactorPanel({ twoFactorEnabled }: { twoFactorEnabled: boolean }) {
  const t = useTranslations('web.account.security');
  const tErrors = useTranslations('web.auth');
  const tValidation = useTranslations('common.validation');
  const router = useRouter();

  const [stage, setStage] = useState<Stage>(twoFactorEnabled ? 'enabled' : 'idle');
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null);
  const [savedBackupCodes, setSavedBackupCodes] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const enrollForm = useForm<{ password: string }>({
    resolver: zodResolver(TotpEnrollRequestSchema),
    defaultValues: { password: '' },
  });
  const verifyForm = useForm<{ code: string }>({
    resolver: zodResolver(TotpVerifyRequestSchema),
    defaultValues: { code: '' },
  });
  const disableForm = useForm<{ code: string; password: string }>({
    resolver: zodResolver(TotpDisableRequestSchema),
    defaultValues: { code: '', password: '' },
  });

  async function onEnrollPassword(values: { password: string }) {
    setNotice(null);
    const { data, error } = await api.POST('/v1/auth/totp/enroll', { body: values });
    if (error) {
      setNotice({ tone: 'error', message: authErrorMessage(tErrors, error) });
      return;
    }
    setEnrollment(data);
    setSavedBackupCodes(false);
    setStage('enroll-verify');
    enrollForm.reset();
  }

  async function onVerify(values: { code: string }) {
    setNotice(null);
    const { error } = await api.POST('/v1/auth/totp/verify', { body: values });
    if (error) {
      setNotice({ tone: 'error', message: authErrorMessage(tErrors, error) });
      return;
    }
    setEnrollment(null);
    setStage('enabled');
    setNotice({ tone: 'success', message: t('enabled') });
    verifyForm.reset();
    router.refresh();
  }

  async function onDisable(values: { code: string; password: string }) {
    setNotice(null);
    const { error } = await api.POST('/v1/auth/totp/disable', { body: values });
    if (error) {
      setNotice({ tone: 'error', message: authErrorMessage(tErrors, error) });
      return;
    }
    setStage('idle');
    setNotice({ tone: 'success', message: t('disabled') });
    disableForm.reset();
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="security-heading">
      <h2 id="security-heading" className="text-lg font-semibold text-foreground">
        {t('title')}
      </h2>
      <p className="text-sm text-muted-foreground">
        {stage === 'enabled' || stage === 'disable'
          ? t('twoFactorEnabled')
          : t('twoFactorDisabled')}
      </p>
      {notice ? <FormNotice tone={notice.tone}>{notice.message}</FormNotice> : null}

      {stage === 'idle' ? (
        <Button
          type="button"
          onClick={() => {
            setStage('enroll-password');
          }}
        >
          {t('enable2fa')}
        </Button>
      ) : null}

      {stage === 'enroll-password' ? (
        <form
          noValidate
          onSubmit={(event) => void enrollForm.handleSubmit(onEnrollPassword)(event)}
          className="flex flex-col gap-3"
        >
          <p className="text-sm text-foreground">{t('confirmPasswordTitle')}</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="enroll-password">{t('passwordLabel')}</Label>
            <Input
              id="enroll-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(enrollForm.formState.errors.password)}
              {...enrollForm.register('password')}
            />
            <FieldError
              id="enroll-password-error"
              message={fieldErrorMessage(tValidation, enrollForm.formState.errors.password)}
            />
          </div>
          <Button type="submit" disabled={enrollForm.formState.isSubmitting}>
            {t('startEnrollCta')}
          </Button>
        </form>
      ) : null}

      {stage === 'enroll-verify' && enrollment ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold text-foreground">{t('scanTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('scanDescription')}</p>
            <Label htmlFor="totp-secret">{t('secretLabel')}</Label>
            <code
              id="totp-secret"
              className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
            >
              {enrollment.secret}
            </code>
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold text-foreground">{t('backupCodesTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('backupCodesDescription')}</p>
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
              {t('backupCodesConfirm')}
            </label>
          </div>
          <form
            noValidate
            onSubmit={(event) => void verifyForm.handleSubmit(onVerify)(event)}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="verify-code">{t('verifyCodeLabel')}</Label>
              <Input
                id="verify-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                aria-invalid={Boolean(verifyForm.formState.errors.code)}
                {...verifyForm.register('code')}
              />
              <FieldError
                id="verify-code-error"
                message={fieldErrorMessage(tValidation, verifyForm.formState.errors.code)}
              />
            </div>
            <Button type="submit" disabled={!savedBackupCodes || verifyForm.formState.isSubmitting}>
              {t('verifyCta')}
            </Button>
          </form>
        </div>
      ) : null}

      {stage === 'enabled' ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setStage('disable');
          }}
        >
          {t('disable2fa')}
        </Button>
      ) : null}

      {stage === 'disable' ? (
        <form
          noValidate
          onSubmit={(event) => void disableForm.handleSubmit(onDisable)(event)}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="disable-code">{t('disableCodeLabel')}</Label>
            <Input
              id="disable-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              aria-invalid={Boolean(disableForm.formState.errors.code)}
              {...disableForm.register('code')}
            />
            <FieldError
              id="disable-code-error"
              message={fieldErrorMessage(tValidation, disableForm.formState.errors.code)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="disable-password">{t('disablePasswordLabel')}</Label>
            <Input
              id="disable-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(disableForm.formState.errors.password)}
              {...disableForm.register('password')}
            />
            <FieldError
              id="disable-password-error"
              message={fieldErrorMessage(tValidation, disableForm.formState.errors.password)}
            />
          </div>
          <Button type="submit" disabled={disableForm.formState.isSubmitting}>
            {t('disableCta')}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
