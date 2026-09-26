'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Locale } from '@photoo/shared';

import { ConfirmActionButton } from '@/components/requests/confirm-action-button';
import { api } from '@/lib/api';
import { requestErrorMessage } from '@/lib/request-errors';

export function DeleteAccountAction({ locale }: { locale: Locale }) {
  const t = useTranslations('web.account.dangerZone');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount(): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const { error: apiError } = await api.POST('/v1/me/data-requests', {
        body: { type: 'delete' },
      });
      if (apiError) {
        setError(requestErrorMessage(t, apiError));
        return false;
      }
      try {
        await api.POST('/v1/auth/sign-out');
      } catch {
        // no-op
      }
      router.push(`/${locale}/account/deletion/requested`);
      router.refresh();
      return true;
    } catch {
      setError(t('errors.generic'));
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <ConfirmActionButton
      triggerLabel={t('deleteAccount')}
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
      onConfirm={deleteAccount}
    />
  );
}
