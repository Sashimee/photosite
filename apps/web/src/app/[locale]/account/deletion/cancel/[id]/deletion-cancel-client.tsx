'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { Locale } from '@photoo/shared';

import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { parseFragmentToken } from '@/lib/fragment-token';

type Status = 'pending' | 'success' | 'error';

const ERROR_KEYS = {
  UNAUTHORIZED: 'unauthorized',
  NOT_FOUND: 'notFound',
  NOT_DELETION: 'notDeletion',
  GRACE_PERIOD_ENDED: 'gracePeriodEnded',
  NOT_PENDING: 'notPending',
} as const;

export function DeletionCancelClient({ locale, id }: { locale: Locale; id: string }) {
  const t = useTranslations('web.account.deletionCancel');
  const [status, setStatus] = useState<Status>('pending');
  const [errorKey, setErrorKey] = useState<string>('generic');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    const token = parseFragmentToken(window.location.hash);
    void api
      .POST('/v1/me/data-requests/{id}/cancel', {
        params: { path: { id } },
        body: token ? { token } : undefined,
      })
      .then(({ error }) => {
        if (error) {
          setErrorKey(
            (error.code && ERROR_KEYS[error.code as keyof typeof ERROR_KEYS]) || 'generic',
          );
          setStatus('error');
          return;
        }
        setStatus('success');
      });
    // Runs once on mount to consume the fragment token exactly one time.
  }, [id]);

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      {status === 'pending' ? <FormNotice tone="info">{t('pending')}</FormNotice> : null}
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
          {t(errorKey)}{' '}
          <Link href={`/${locale}/sign-in`} className="font-medium underline">
            {t('signInLink')}
          </Link>
        </FormNotice>
      ) : null}
    </section>
  );
}
