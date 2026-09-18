'use client';

import { useTranslations } from 'next-intl';

export function TypingIndicator({ name }: { name: string | null }) {
  const t = useTranslations('web.messages.thread');

  if (!name) {
    return null;
  }

  return (
    <p role="status" className="text-xs text-muted-foreground">
      {t('typingIndicator', { name })}
    </p>
  );
}
