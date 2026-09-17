'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { ConfirmPasswordResetRequestSchema, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';
import { fieldErrorMessage } from '@/lib/form-errors';
import { parseFragmentToken } from '@/lib/fragment-token';

interface ResetPasswordFormValues {
  password: string;
}

export function ResetPasswordClient({ locale }: { locale: Locale }) {
  const t = useTranslations('web.auth.resetPassword');
  const tErrors = useTranslations('web.auth');
  const tValidation = useTranslations('common.validation');
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setToken(parseFragmentToken(window.location.hash));
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(ConfirmPasswordResetRequestSchema.omit({ token: true })),
    defaultValues: { password: '' },
  });

  async function onSubmit(values: ResetPasswordFormValues) {
    if (!token) {
      return;
    }
    setSubmitError(null);
    const { error } = await api.POST('/v1/auth/password-reset/confirm', {
      body: { token, password: values.password },
    });
    if (error) {
      setSubmitError(authErrorMessage(tErrors, error));
      return;
    }
    setSuccess(true);
  }

  if (token === undefined) {
    return null;
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>

      {!token ? (
        <FormNotice tone="error">
          {t('missingToken')}{' '}
          <Link href={`/${locale}/forgot-password`} className="font-medium underline">
            {t('requestNewLink')}
          </Link>
        </FormNotice>
      ) : success ? (
        <FormNotice tone="success">
          {t('success')}{' '}
          <Link href={`/${locale}/sign-in`} className="font-medium underline">
            {t('signInLink')}
          </Link>
        </FormNotice>
      ) : (
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-password-password">{t('passwordLabel')}</Label>
            <Input
              id="reset-password-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby="reset-password-hint reset-password-error"
              {...register('password')}
            />
            <p id="reset-password-hint" className="text-sm text-muted-foreground">
              {t('passwordHint')}
            </p>
            <FieldError
              id="reset-password-error"
              message={fieldErrorMessage(tValidation, errors.password)}
            />
          </div>
          <Button type="submit" disabled={isSubmitting}>
            {t('submit')}
          </Button>
        </form>
      )}
    </section>
  );
}
