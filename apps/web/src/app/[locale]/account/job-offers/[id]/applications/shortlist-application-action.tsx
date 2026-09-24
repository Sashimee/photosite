'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { JobApplicationStatus } from '@photoo/shared';

import { ConfirmActionButton } from '@/components/requests/confirm-action-button';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

export function ShortlistApplicationAction({
  applicationId,
  status,
}: {
  applicationId: string;
  status: JobApplicationStatus;
}) {
  const t = useTranslations('web.jobApplications.inbox');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'submitted') {
    return null;
  }

  async function shortlist(): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const { error: apiError } = await api.POST('/v1/job-applications/{id}/status', {
        params: { path: { id: applicationId } },
        body: { status: 'shortlisted' },
      });
      if (apiError) {
        setError(
          apiError.code === 'CONFLICT'
            ? t('errors.alreadyDecided')
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
      triggerLabel={t('shortlistCta')}
      title={t('shortlistConfirmTitle')}
      description={t('shortlistConfirmDescription')}
      confirmLabel={t('shortlistConfirmCta')}
      pendingLabel={t('shortlistPending')}
      cancelLabel={t('shortlistDismissCta')}
      pending={pending}
      error={error}
      onOpen={() => {
        setError(null);
      }}
      onConfirm={shortlist}
    />
  );
}
