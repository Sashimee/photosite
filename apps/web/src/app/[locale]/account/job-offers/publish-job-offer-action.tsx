'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmActionButton } from '@/components/requests/confirm-action-button';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

export function PublishJobOfferAction({
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

  if (status === 'published') {
    return null;
  }

  async function publish(): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const { error: apiError } = await api.POST('/v1/me/job-offers/{id}/publish', {
        params: { path: { id: jobOfferId } },
      });
      if (apiError) {
        setError(
          apiError.code === 'CONFLICT'
            ? t('errors.alreadyPublished')
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
      triggerLabel={t('publishCta')}
      title={t('publishConfirmTitle')}
      description={t('publishConfirmDescription')}
      confirmLabel={t('publishConfirmCta')}
      pendingLabel={t('publishPending')}
      cancelLabel={t('publishDismissCta')}
      pending={pending}
      error={error}
      onOpen={() => {
        setError(null);
      }}
      onConfirm={publish}
    />
  );
}
