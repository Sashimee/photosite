'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { FormNotice } from '@/components/ui/form-message';

import { RefundDialog } from './refund-dialog';
import { ReverseTransferDialog } from './reverse-transfer-dialog';

export function BookingActions({
  bookingId,
  status,
  transferId,
  currency,
}: {
  bookingId: string;
  status: string;
  transferId: string | null;
  currency: string;
}) {
  const t = useTranslations('admin.finance');
  const router = useRouter();
  const [notice, setNotice] = useState<string | null>(null);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const canRefund = status === 'released';
  const canReverse = status === 'released' || (status === 'disputed' && transferId !== null);

  function done(key: 'refunded' | 'reversed') {
    setNotice(t(`success.${key}`));
    router.refresh();
  }

  function unknown() {
    setOutcomeUnknown(true);
    setNotice(null);
    router.refresh();
  }

  if (!canRefund && !canReverse) {
    return <p className="text-sm text-muted-foreground">{t('detail.actions.none')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {outcomeUnknown ? <FormNotice tone="error">{t('errors.unknownOutcome')}</FormNotice> : null}
      {notice ? <FormNotice tone="success">{notice}</FormNotice> : null}
      <div className="flex flex-wrap gap-2">
        {canRefund ? (
          <RefundDialog
            bookingId={bookingId}
            currency={currency}
            disabled={outcomeUnknown}
            onDone={() => {
              done('refunded');
            }}
            onUnknownOutcome={unknown}
          />
        ) : null}
        {canReverse ? (
          <ReverseTransferDialog
            bookingId={bookingId}
            currency={currency}
            disabled={outcomeUnknown}
            onDone={() => {
              done('reversed');
            }}
            onUnknownOutcome={unknown}
          />
        ) : null}
      </div>
    </div>
  );
}
