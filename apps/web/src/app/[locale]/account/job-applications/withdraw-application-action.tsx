'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { JobApplicationStatus } from '@photoo/shared';

import { ConfirmActionButton } from '@/components/requests/confirm-action-button';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

export function WithdrawApplicationAction({
  applicationId,
  status,
}: {
  applicationId: string;
  status: JobApplicationStatus;
}) {
  const t = useTranslations('web.jobApplications.mine');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every transition, including withdrawn, only succeeds server-side from
  // `submitted` (job-applications.service.ts) - once the professional has
  // shortlisted or rejected an application there is no route back for the
  // applicant either, so this only ever shows up on a still-open row.
  if (status !== 'submitted') {
    return null;
  }

  async function withdraw(): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const { error: apiError } = await api.POST('/v1/job-applications/{id}/status', {
        params: { path: { id: applicationId } },
        body: { status: 'withdrawn' },
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
