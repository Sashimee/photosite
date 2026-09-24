'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmActionButton } from '@/components/requests/confirm-action-button';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

export function CloseJobOfferAction({
  jobOfferId,
  status,
}: {
  jobOfferId: string;
  status: 'draft' | 'published' | 'closed' | 'expired';
}) {
  const t = useTranslations('web.jobOffers');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'published') {
    return null;
  }

  async function close(): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const { error: apiError } = await api.POST('/v1/me/job-offers/{id}/close', {
        params: { path: { id: jobOfferId } },
      });
      if (apiError) {
        setError(
          apiError.code === 'CONFLICT'
            ? t('errors.notOpenToClose')
            : requestErrorMessage(t, apiError),
        );
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setPending(false);
    }
  }

  return (
    <ConfirmActionButton
      triggerLabel={t('closeCta')}
      triggerVariant="outline"
      title={t('closeConfirmTitle')}
      description={t('closeConfirmDescription')}
      confirmLabel={t('closeConfirmCta')}
      pendingLabel={t('closePending')}
      cancelLabel={t('closeDismissCta')}
      pending={pending}
      error={error}
      onOpen={() => {
        setError(null);
      }}
      onConfirm={close}
    />
  );
}
