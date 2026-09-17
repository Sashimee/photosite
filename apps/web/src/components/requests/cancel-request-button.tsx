'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { RequestStatus } from '@photoo/shared';

import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

import { ConfirmActionButton } from './confirm-action-button';

const CANCELLABLE_STATUSES: readonly RequestStatus[] = ['open', 'quoted'];

export function CancelRequestButton({
  requestId,
  status,
}: {
  requestId: string;
  status: RequestStatus;
}) {
  const t = useTranslations('web.requests.detail');
  const tErrors = useTranslations('web.requests');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel(): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const { error: apiError } = await api.POST('/v1/requests/{id}/cancel', {
        params: { path: { id: requestId } },
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
      triggerLabel={t('cancelCta')}
      triggerVariant="outline"
      title={t('cancelConfirmTitle')}
      description={t('cancelConfirmDescription')}
      confirmLabel={t('cancelConfirmCta')}
      pendingLabel={t('cancelPending')}
      cancelLabel={t('cancelDismissCta')}
      hidden={!CANCELLABLE_STATUSES.includes(status)}
      pending={pending}
      error={error}
      onOpen={() => {
        setError(null);
      }}
      onConfirm={cancel}
    />
  );
}
