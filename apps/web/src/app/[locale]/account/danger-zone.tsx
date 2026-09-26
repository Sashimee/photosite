import { getTranslations } from 'next-intl/server';

import type { Locale } from '@photoo/shared';

import { DeleteAccountAction } from './delete-account-action';

// Data export needs the GDPR export endpoint from 1A.12, tracked as #399.
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
      <DeleteAccountAction locale={locale} />
    </section>
  );
}
