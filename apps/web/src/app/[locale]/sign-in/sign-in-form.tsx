'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { SignInRequestSchema, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';
import { fieldErrorMessage } from '@/lib/form-errors';
import { sanitizeNextPath } from '@/lib/next-param';

interface SignInFormValues {
  email: string;
  password: string;
}

export function SignInForm({ locale, next }: { locale: Locale; next?: string | undefined }) {
  const t = useTranslations('web.auth.signIn');
  const tErrors = useTranslations('web.auth');
  const tValidation = useTranslations('common.validation');
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInFormValues>({
    resolver: zodResolver(SignInRequestSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: SignInFormValues) {
    setSubmitError(null);
    const { data, error } = await api.POST('/v1/auth/sign-in', { body: values });
    if (error) {
      setSubmitError(authErrorMessage(tErrors, error));
      return;
    }
    if ('twoFactorRequired' in data) {
      const target = `/${locale}/sign-in/two-factor${next ? `?next=${encodeURIComponent(next)}` : ''}`;
      router.push(target);
      return;
    }
    router.refresh();
    router.push(sanitizeNextPath(next, `/${locale}/account`));
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-4"
      >
        {submitError ? <FormNotice tone="error">{submitError}</FormNotice> : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-in-email">{t('emailLabel')}</Label>
          <Input
            id="sign-in-email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'sign-in-email-error' : undefined}
            {...register('email')}
          />
          <FieldError
            id="sign-in-email-error"
            message={fieldErrorMessage(tValidation, errors.email)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-in-password">{t('passwordLabel')}</Label>
          <Input
            id="sign-in-password"
            type="password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'sign-in-password-error' : undefined}
            {...register('password')}
          />
          <FieldError
            id="sign-in-password-error"
            message={fieldErrorMessage(tValidation, errors.password)}
          />
        </div>

        <Link
          href={`/${locale}/forgot-password`}
          className="self-start text-sm font-medium text-foreground underline"
        >
          {t('forgotPassword')}
        </Link>

        <Button type="submit" disabled={isSubmitting}>
          {t('submit')}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <Link href={`/${locale}/sign-up`} className="font-medium text-foreground underline">
          {t('signUpLink')}
        </Link>
      </p>
    </section>
  );
}
