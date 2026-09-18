'use client';

import { useTranslations } from 'next-intl';

import type { ConnectionState } from '@/lib/use-conversation';

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const t = useTranslations('web.messages.thread');

  if (state !== 'disconnected') {
    return null;
  }

  return (
    <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
      {t('reconnecting')}
    </p>
  );
}
