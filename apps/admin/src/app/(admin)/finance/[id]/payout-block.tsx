import { useTranslations } from 'next-intl';

import type { components } from '@photoo/api-client';

import { CopyText } from '@/components/copy-text';

import { LedgerTable } from './ledger-table';

type Payout = components['schemas']['AdminBookingPayout'];

export function PayoutBlock({ payout }: { payout: Payout | null }) {
  const t = useTranslations('admin.finance.detail.payout');

  if (!payout) {
    return <p className="text-sm text-muted-foreground">{t('none')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('stripeAccountId')}</dt>
        <dd className="text-foreground">
          <CopyText value={payout.stripeAccountId} />
        </dd>
        <dt className="text-muted-foreground">{t('onboardingComplete')}</dt>
        <dd className="text-foreground">{payout.onboardingComplete ? t('yes') : t('no')}</dd>
        <dt className="text-muted-foreground">{t('payoutsEnabled')}</dt>
        <dd className="text-foreground">{payout.payoutsEnabled ? t('yes') : t('no')}</dd>
      </dl>
      <LedgerTable
        entries={payout.entries}
        caption={t('entriesCaption')}
        emptyLabel={t('noEntries')}
      />
    </div>
  );
}
