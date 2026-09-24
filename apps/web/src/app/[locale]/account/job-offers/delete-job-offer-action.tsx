'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ConfirmActionButton } from '@/components/requests/confirm-action-button';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

export function DeleteJobOfferAction({
  jobOfferId,
  redirectTo,
}: {
  jobOfferId: string;
  redirectTo?: string;
}) {
  const t = useTranslations('web.jobOffers');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteJobOffer(): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const { error: apiError } = await api.DELETE('/v1/me/job-offers/{id}', {
        params: { path: { id: jobOfferId } },
      });
      if (apiError) {
        setError(requestErrorMessage(t, apiError));
        return false;
      }
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
      return true;
    } finally {
      setPending(false);
    }
  }

  return (
    <ConfirmActionButton
      triggerLabel={t('deleteCta')}
      triggerVariant="outline"
      title={t('deleteConfirmTitle')}
      description={t('deleteConfirmDescription')}
      confirmLabel={t('deleteConfirmCta')}
      pendingLabel={t('deletePending')}
      cancelLabel={t('deleteDismissCta')}
      pending={pending}
      error={error}
      onOpen={() => {
        setError(null);
      }}
      onConfirm={deleteJobOffer}
    />
  );
}
