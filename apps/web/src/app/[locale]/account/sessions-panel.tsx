'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import { authErrorMessage } from '@/lib/auth-errors';

export function SessionsPanel({ locale }: { locale: Locale }) {
  const t = useTranslations('web.account.sessions');
  const tErrors = useTranslations('web.auth');
  const router = useRouter();
  const [pending, setPending] = useState<'signOut' | 'signOutEverywhere' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signOut(everywhere: boolean) {
    setPending(everywhere ? 'signOutEverywhere' : 'signOut');
    setError(null);
    const { error: apiError } = everywhere
      ? await api.POST('/v1/auth/sessions/revoke-all')
      : await api.POST('/v1/auth/sign-out');
    setPending(null);
    if (apiError) {
      setError(authErrorMessage(tErrors, apiError));
      return;
    }
    router.push(`/${locale}/sign-in`);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-4" aria-labelledby="sessions-heading">
      <h2 id="sessions-heading" className="text-lg font-semibold text-foreground">
        {t('title')}
      </h2>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      {error ? <FormNotice tone="error">{error}</FormNotice> : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() => void signOut(false)}
        >
          {t('signOut')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending !== null}
          onClick={() => void signOut(true)}
        >
          {t('signOutEverywhere')}
        </Button>
      </div>
    </section>
  );
}
