'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { components } from '@photoo/api-client';

import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

import { ConfirmActionButton } from './confirm-action-button';

type Quote = components['schemas']['Quote'];

export function WithdrawQuoteAction({ quote }: { quote: Quote }) {
  const t = useTranslations('web.quotes.detail');
  const tErrors = useTranslations('web.quotes');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (quote.status !== 'sent') {
    return null;
  }

  async function withdraw(): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const { error: apiError } = await api.POST('/v1/quotes/{id}/withdraw', {
        params: { path: { id: quote.id } },
      });
      if (apiError) {
        setError(requestErrorMessage(tErrors, apiError));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(requestErrorMessage(tErrors, undefined));
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <ConfirmActionButton
      triggerLabel={t('withdrawCta')}
      triggerVariant="outline"
      title={t('withdrawConfirmTitle')}
      description={t('withdrawConfirmDescription')}
      confirmLabel={t('withdrawConfirmCta')}
      pendingLabel={t('withdrawPending')}
      cancelLabel={t('withdrawDismissCta')}
      pending={pending}
      error={error}
      onOpen={() => {
        setError(null);
      }}
      onConfirm={withdraw}
    />
  );
}
