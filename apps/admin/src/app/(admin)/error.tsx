'use client';

import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('admin.error');
  const tCommon = useTranslations('common');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
      <p className="text-muted-foreground">{t('description')}</p>
      <Button
        onClick={() => {
          reset();
        }}
      >
        {tCommon('retry')}
      </Button>
    </section>
  );
}
