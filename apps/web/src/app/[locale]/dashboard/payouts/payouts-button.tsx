'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function PayoutsButton({ resume }: { resume: boolean }) {
  const t = useTranslations('web.dashboard.payouts');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function errorMessage(apiError: { code?: string | undefined; details?: unknown } | undefined) {
    return apiError?.code === 'EMAIL_NOT_VERIFIED'
      ? t('errors.emailNotVerified')
      : requestErrorMessage(t, apiError);
  }

  async function start() {
    setPending(true);
    setError(null);
    try {
      const account = await api.POST('/v1/me/stripe/account');
      if (account.error) {
        setError(errorMessage(account.error));
        setPending(false);
        return;
      }
      const link = await api.POST('/v1/me/stripe/account-link');
      if (link.error) {
        setError(errorMessage(link.error));
        setPending(false);
        return;
      }
      const url: unknown = link.data.url;
      if (!isHttpsUrl(url)) {
        setError(t('errors.generic'));
        setPending(false);
        return;
      }
      window.location.assign(url);
    } catch {
      setError(requestErrorMessage(t, undefined));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {error ? <FormNotice tone="error">{error}</FormNotice> : null}
      <Button type="button" disabled={pending} aria-busy={pending} onClick={() => void start()}>
        {pending ? t('pending') : resume ? t('continueCta') : t('setupCta')}
      </Button>
    </div>
  );
}
