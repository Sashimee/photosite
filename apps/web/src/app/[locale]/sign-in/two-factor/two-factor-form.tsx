'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { SignInTotpRequestSchema, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';
import { fieldErrorMessage } from '@/lib/form-errors';
import { sanitizeNextPath } from '@/lib/next-param';

type TwoFactorFormValues = z.infer<typeof SignInTotpRequestSchema>;

export function TwoFactorForm({ locale, next }: { locale: Locale; next?: string | undefined }) {
  const t = useTranslations('web.auth.twoFactor');
  const tErrors = useTranslations('web.auth');
  const tValidation = useTranslations('common.validation');
  const router = useRouter();
  const [mode, setMode] = useState<'code' | 'backupCode'>('code');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<TwoFactorFormValues>({
    resolver: zodResolver(SignInTotpRequestSchema),
    shouldUnregister: true,
  });

  function toggleMode() {
    resetField(mode);
    setMode(mode === 'code' ? 'backupCode' : 'code');
  }

  async function onSubmit(values: TwoFactorFormValues) {
    setSubmitError(null);
    const body = values.code ? { code: values.code } : { backupCode: values.backupCode ?? '' };
    const { error } = await api.POST('/v1/auth/sign-in/totp', { body });
    if (error) {
      setSubmitError(authErrorMessage(tErrors, error));
      return;
    }
    router.refresh();
    router.push(sanitizeNextPath(next, `/${locale}/account`));
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-4"
      >
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}

        {mode === 'code' ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="two-factor-code">{t('codeLabel')}</Label>
            <Input
              id="two-factor-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              aria-invalid={Boolean(errors.code)}
              aria-describedby={errors.code ? 'two-factor-code-error' : undefined}
              {...register('code')}
            />
            <FieldError
              id="two-factor-code-error"
              message={fieldErrorMessage(tValidation, errors.code)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="two-factor-backup-code">{t('backupCodeLabel')}</Label>
            <Input
              id="two-factor-backup-code"
              type="text"
              autoComplete="off"
              aria-invalid={Boolean(errors.backupCode)}
              aria-describedby={errors.backupCode ? 'two-factor-backup-code-error' : undefined}
              {...register('backupCode')}
            />
            <FieldError
              id="two-factor-backup-code-error"
              message={fieldErrorMessage(tValidation, errors.backupCode)}
            />
          </div>
        )}

        <button
          type="button"
          onClick={toggleMode}
          className="self-start text-sm font-medium text-foreground underline"
        >
          {mode === 'code' ? t('useBackupCode') : t('useAuthenticatorCode')}
        </button>

        <Button type="submit" disabled={isSubmitting}>
          {t('submit')}
        </Button>
      </form>
    </section>
  );
}
