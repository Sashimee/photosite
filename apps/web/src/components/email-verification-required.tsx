'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';

type ResendState = 'idle' | 'pending' | 'sent' | 'rateLimited' | 'error';

// Shared prompt for the `EMAIL_NOT_VERIFIED` guard (#273/#290). Takes only
// the session's own `email` and no caller-specific copy or links, so it
// renders unchanged wherever the guard can fire.
export function EmailVerificationRequired({ email }: { email: string }) {
  const t = useTranslations('web.emailVerification');
  const tAuth = useTranslations('web.auth');
  const [state, setState] = useState<ResendState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function resend() {
    setState('pending');
    setErrorMessage(null);
    const { error } = await api.POST('/v1/auth/verify-email/resend', { body: { email } });
    if (error) {
      setState(error.code === 'TOO_MANY_REQUESTS' ? 'rateLimited' : 'error');
      setErrorMessage(authErrorMessage(tAuth, error));
      return;
    }
    setState('sent');
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted px-4 py-3">
      <p className="text-sm text-foreground">{t('message')}</p>
      {state === 'sent' ? <FormNotice tone="success">{t('sent')}</FormNotice> : null}
      {(state === 'rateLimited' || state === 'error') && errorMessage ? (
        <FormNotice tone="error">{errorMessage}</FormNotice>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={state === 'pending'}
        onClick={() => void resend()}
      >
        {state === 'pending' ? t('sending') : t('resendCta')}
      </Button>
    </div>
  );
}
