'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

import { useConsent } from './consent-provider';

// Three actions, equally weighted: accept and reject share the same button
// style so neither reads as the "real" choice, and manage sits alongside
// them rather than being the only way to refuse (docs/steps/1B.10-consent.md
// "Decisions for this step").
export function ConsentBanner() {
  const t = useTranslations('web.consent.banner');
  const { bannerVisible, acceptAll, rejectAll, openManage } = useConsent();

  if (!bannerVisible) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('title')}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="default" onClick={acceptAll}>
            {t('acceptAll')}
          </Button>
          <Button type="button" variant="default" onClick={rejectAll}>
            {t('rejectAll')}
          </Button>
          <Button type="button" variant="outline" onClick={openManage}>
            {t('manage')}
          </Button>
        </div>
      </div>
    </div>
  );
}
