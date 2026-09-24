'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { JobApplicationStatus } from '@photoo/shared';

import { ConfirmActionButton } from '@/components/requests/confirm-action-button';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

export function RejectApplicationAction({
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

  async function reject(): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const { error: apiError } = await api.POST('/v1/job-applications/{id}/status', {
        params: { path: { id: applicationId } },
        body: { status: 'rejected' },
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
      triggerLabel={t('rejectCta')}
      triggerVariant="outline"
      title={t('rejectConfirmTitle')}
      description={t('rejectConfirmDescription')}
      confirmLabel={t('rejectConfirmCta')}
      pendingLabel={t('rejectPending')}
      cancelLabel={t('rejectDismissCta')}
      pending={pending}
      error={error}
      onOpen={() => {
        setError(null);
      }}
      onConfirm={reject}
    />
  );
}
