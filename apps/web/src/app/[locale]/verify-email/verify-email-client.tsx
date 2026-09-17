'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { Locale } from '@photoo/shared';

import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';
import { parseFragmentToken } from '@/lib/fragment-token';

type Status = 'verifying' | 'success' | 'error';

export function VerifyEmailClient({ locale }: { locale: Locale }) {
  const t = useTranslations('web.auth.verifyEmail');
  const tErrors = useTranslations('web.auth');
  const [status, setStatus] = useState<Status>('verifying');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    const token = parseFragmentToken(window.location.hash);
    if (!token) {
      setStatus('error');
      return;
    }

    void api.POST('/v1/auth/verify-email', { body: { token } }).then(({ error }) => {
      if (error) {
        setErrorMessage(authErrorMessage(tErrors, error));
        setStatus('error');
        return;
      }
      setStatus('success');
    });
    // Runs once on mount to consume the fragment token exactly one time.
  }, [tErrors]);

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      {status === 'verifying' ? <FormNotice tone="info">{t('verifying')}</FormNotice> : null}
      {status === 'success' ? (
        <FormNotice tone="success">
          {t('success')}{' '}
          <Link href={`/${locale}/account`} className="font-medium underline">
            {t('continue')}
          </Link>
        </FormNotice>
      ) : null}
      {status === 'error' ? (
        <FormNotice tone="error">
          {errorMessage ?? t('invalidToken')}{' '}
          <Link href={`/${locale}/sign-in`} className="font-medium underline">
            {t('signInLink')}
          </Link>
        </FormNotice>
      ) : null}
    </section>
  );
}
