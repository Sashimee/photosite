'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { SIGNUP_ROLES, SignUpRequestSchema, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FieldError, FormNotice } from '@/components/ui/form-message';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';
import { fieldErrorMessage } from '@/lib/form-errors';

type SignUpRole = (typeof SIGNUP_ROLES)[number];

interface SignUpFormValues {
  email: string;
  password: string;
  roles: SignUpRole[];
  locale: Locale;
}

export function SignUpForm({ locale }: { locale: Locale }) {
  const t = useTranslations('web.auth.signUp');
  const tRoles = useTranslations('web.auth.roles');
  const tErrors = useTranslations('web.auth');
  const tValidation = useTranslations('web.auth');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpFormValues>({
    resolver: zodResolver(SignUpRequestSchema),
    defaultValues: { email: '', password: '', roles: [], locale },
  });

  async function onSubmit(values: SignUpFormValues) {
    setSubmitError(null);
    const { error } = await api.POST('/v1/auth/sign-up', { body: values });
    if (error) {
      setSubmitError(authErrorMessage(tErrors, error));
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return (
      <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
        <FormNotice tone="success">{t('success')}</FormNotice>
      </section>
    );
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
          <Label htmlFor="sign-up-email">{t('emailLabel')}</Label>
          <Input
            id="sign-up-email"
            type="email"
            autoComplete="email"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'sign-up-email-error' : undefined}
            {...register('email')}
          />
          <FieldError
            id="sign-up-email-error"
            message={fieldErrorMessage(tValidation, errors.email)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sign-up-password">{t('passwordLabel')}</Label>
          <Input
            id="sign-up-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            aria-describedby="sign-up-password-hint sign-up-password-error"
            {...register('password')}
          />
          <p id="sign-up-password-hint" className="text-sm text-muted-foreground">
            {t('passwordHint')}
          </p>
          <FieldError
            id="sign-up-password-error"
            message={fieldErrorMessage(tValidation, errors.password)}
          />
        </div>

        <Controller
          control={control}
          name="roles"
          render={({ field }) => (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">{t('roleLabel')}</legend>
              {SIGNUP_ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="radio"
                    name="sign-up-role"
                    value={role}
                    checked={field.value[0] === role}
                    onChange={() => {
                      field.onChange([role]);
                    }}
                    className="size-4"
                  />
                  {tRoles(role)}
                </label>
              ))}
              <FieldError
                id="sign-up-role-error"
                message={fieldErrorMessage(tValidation, errors.roles)}
              />
            </fieldset>
          )}
        />

        <Button type="submit" disabled={isSubmitting}>
          {t('submit')}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        {t('alreadyHaveAccount')}{' '}
        <Link href={`/${locale}/sign-in`} className="font-medium text-foreground underline">
          {t('signInLink')}
        </Link>
      </p>
    </section>
  );
}
