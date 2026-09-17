import { getTranslations } from 'next-intl/server';

import type { Locale } from '@photoo/shared';

// Data export and account deletion need the GDPR endpoints from 1A.12,
// listed in apps/api/src/openapi/not-yet-implemented.ts.
export async function DangerZone({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'web.account.dangerZone' });

  return (
    <section className="flex flex-col gap-4" aria-labelledby="danger-zone-heading">
      <h2 id="danger-zone-heading" className="text-lg font-semibold text-foreground">
        {t('title')}
      </h2>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled
          className="self-start rounded-md border border-border px-4 py-2 text-sm text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('exportData')}
        </button>
        <p className="text-sm text-muted-foreground">{t('exportComingSoon')}</p>
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled
          className="self-start rounded-md border border-destructive/40 px-4 py-2 text-sm text-destructive disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('deleteAccount')}
        </button>
        <p className="text-sm text-muted-foreground">{t('deleteComingSoon')}</p>
      </div>
    </section>
  );
}
