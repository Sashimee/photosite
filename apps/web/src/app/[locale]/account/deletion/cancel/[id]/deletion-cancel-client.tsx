'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { DataRequestCancelConflictCode, Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { parseFragmentToken } from '@/lib/fragment-token';
import { retryAfterSeconds, type ApiErrorLike, type TranslateFn } from '@/lib/request-errors';

type Status = 'idle' | 'pending' | 'success' | 'error';

const ERROR_KEYS = {
  NOT_DELETION: 'notDeletion',
  GRACE_PERIOD_ENDED: 'gracePeriodEnded',
  NOT_PENDING: 'notPending',
  UNAUTHORIZED: 'unauthorized',
  NOT_FOUND: 'notFound',
} satisfies Record<DataRequestCancelConflictCode | 'UNAUTHORIZED' | 'NOT_FOUND', string>;

type ErrorKind = keyof typeof ERROR_KEYS | 'TOO_MANY_REQUESTS' | 'VALIDATION_ERROR' | 'GENERIC';

function resolveErrorKind(error: ApiErrorLike | undefined): ErrorKind {
  if (!error?.code) {
    return 'GENERIC';
  }
  if (error.code === 'TOO_MANY_REQUESTS' || error.code === 'VALIDATION_ERROR') {
    return error.code;
  }
  return error.code in ERROR_KEYS ? (error.code as keyof typeof ERROR_KEYS) : 'GENERIC';
}

function resolveErrorMessage(t: TranslateFn, error: ApiErrorLike | undefined): string {
  const kind = resolveErrorKind(error);
  if (kind === 'TOO_MANY_REQUESTS') {
    const seconds = retryAfterSeconds(error?.details);
    return seconds === undefined
      ? t('tooManyRequests')
      : t('tooManyRequestsWithRetry', { seconds });
  }
  if (kind === 'VALIDATION_ERROR') {
    return t('invalidLink');
  }
  if (kind === 'GENERIC') {
    return t('generic');
  }
  return t(ERROR_KEYS[kind]);
}

function showSignIn(error: ApiErrorLike | undefined): boolean {
  const kind = resolveErrorKind(error);
  return kind === 'GENERIC' || kind === 'UNAUTHORIZED';
}

export function DeletionCancelClient({ locale, id }: { locale: Locale; id: string }) {
  const t = useTranslations('web.account.deletionCancel');
  const [status, setStatus] = useState<Status>('idle');
  const [apiError, setApiError] = useState<ApiErrorLike | undefined>(undefined);
  const tokenizedOnce = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const sentRef = useRef(false);

  useEffect(() => {
    if (tokenizedOnce.current) {
      return;
    }
    tokenizedOnce.current = true;
    tokenRef.current = parseFragmentToken(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  function handleConfirm() {
    if (sentRef.current) {
      return;
    }
    sentRef.current = true;
    setStatus('pending');

    const token = tokenRef.current;
    void api
      .POST('/v1/me/data-requests/{id}/cancel', {
        params: { path: { id } },
        body: token ? { token } : undefined,
      })
      .then(({ error }) => {
        if (error) {
          setApiError(error);
          setStatus('error');
          return;
        }
        setStatus('success');
      })
      .catch(() => {
        setApiError(undefined);
        setStatus('error');
      });
  }

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
      {status === 'idle' ? (
        <>
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
          <Button type="button" onClick={handleConfirm}>
            {t('confirmCta')}
          </Button>
        </>
      ) : null}
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
          {resolveErrorMessage(t, apiError)}
          {showSignIn(apiError) ? (
            <>
              {' '}
              <Link href={`/${locale}/sign-in`} className="font-medium underline">
                {t('signInLink')}
              </Link>
            </>
          ) : null}
        </FormNotice>
      ) : null}
    </section>
  );
}
