'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { RequestPasswordResetRequestSchema } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';
import { fieldErrorMessage } from '@/lib/form-errors';

interface ForgotPasswordFormValues {
  email: string;
}

export function ForgotPasswordForm() {
  const t = useTranslations('web.auth.forgotPassword');
  const tErrors = useTranslations('web.auth');
  const tValidation = useTranslations('common.validation');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(RequestPasswordResetRequestSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: ForgotPasswordFormValues) {
    setSubmitError(null);
    // Enumeration-safe: the API always returns 202 with the same message,
    // regardless of whether the account exists.
    const { error } = await api.POST('/v1/auth/password-reset/request', { body: values });
    if (error) {
      setSubmitError(authErrorMessage(tErrors, error));
      return;
    }
    setSuccess(true);
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      {success ? (
        <FormNotice tone="success">{t('success')}</FormNotice>
      ) : (
        <form
          noValidate
          onSubmit={(event) => void handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="forgot-password-email">{t('emailLabel')}</Label>
            <Input
              id="forgot-password-email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'forgot-password-email-error' : undefined}
              {...register('email')}
            />
            <FieldError
              id="forgot-password-email-error"
              message={fieldErrorMessage(tValidation, errors.email)}
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
