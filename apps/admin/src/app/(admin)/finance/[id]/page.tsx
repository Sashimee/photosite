import { getFormatter, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { CopyText } from '@/components/copy-text';
import { formatCents, requireMoney } from '@/lib/money';
import { serverApi } from '@/lib/server-api';

import { BookingActions } from './booking-actions';

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const api = await serverApi();

  const { data: booking, response } = await api.GET('/v1/admin/bookings/{id}', {
    params: { path: { id } },
  });

  if (response.status === 404) {
    notFound();
  }
  if (!booking) {
    throw new Error(`Failed to load booking ${id}: HTTP ${String(response.status)}`);
  }

  const t = await getTranslations('admin.finance');
  const format = await getFormatter();
  const total = requireMoney(booking.total, `total of booking ${id}`);
  const { currency } = total;

  const timestamps = [
    ['scheduledAt', booking.scheduledAt],
    ['deliveredAt', booking.deliveredAt],
    ['releaseDueAt', booking.releaseDueAt],
    ['releasedAt', booking.releasedAt],
    ['cancelledAt', booking.cancelledAt],
  ] as const;
  const stripeIds = [
    ['paymentIntent', booking.paymentIntentId],
    ['charge', booking.chargeId],
    ['transfer', booking.transferId],
  ] as const;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('detail.title')}</h1>
        <p className="font-mono text-sm text-muted-foreground">{booking.id}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('detail.fields.status')}</dt>
        <dd className="text-foreground">{t(`statuses.${booking.status}`)}</dd>
        <dt className="text-muted-foreground">{t('detail.fields.dispute')}</dt>
        <dd className="text-foreground">
          {booking.disputeStatus ? t(`disputeStatuses.${booking.disputeStatus}`) : t('none')}
        </dd>
        <dt className="text-muted-foreground">{t('detail.fields.clientId')}</dt>
        <dd className="font-mono text-xs text-foreground">{booking.clientId}</dd>
        <dt className="text-muted-foreground">{t('detail.fields.photographerId')}</dt>
        <dd className="font-mono text-xs text-foreground">{booking.photographerId}</dd>
        {timestamps.map(([field, value]) =>
          value ? (
            <div key={field} className="contents">
              <dt className="text-muted-foreground">{t(`detail.fields.${field}`)}</dt>
              <dd className="text-foreground">{format.dateTime(new Date(value), 'medium')}</dd>
            </div>
          ) : null,
        )}
        {booking.cancellationReason ? (
          <>
            <dt className="text-muted-foreground">{t('detail.fields.cancellationReason')}</dt>
            <dd className="whitespace-pre-wrap text-foreground">{booking.cancellationReason}</dd>
          </>
        ) : null}
      </dl>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">{t('detail.money.title')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('detail.money.total')}</dt>
          <dd className="text-foreground">{formatCents(format, total.amountCents, currency)}</dd>
          <dt className="text-muted-foreground">{t('detail.money.refunded')}</dt>
          <dd className="text-foreground">
            {formatCents(format, booking.refundedCents, currency)}
          </dd>
          <dt className="text-muted-foreground">{t('detail.money.reversed')}</dt>
          <dd className="text-foreground">
            {formatCents(format, booking.reversedCents, currency)}
          </dd>
        </dl>
        <p className="text-xs text-muted-foreground">{t('detail.money.limitHint')}</p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">{t('detail.stripe.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('detail.stripe.hint')}</p>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {stripeIds.map(([field, value]) => (
            <div key={field} className="contents">
              <dt className="text-muted-foreground">{t(`detail.stripe.${field}`)}</dt>
              <dd className="text-foreground">{value ? <CopyText value={value} /> : t('none')}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-foreground">{t('detail.actions.title')}</h2>
        <BookingActions
          bookingId={booking.id}
          status={booking.status}
          transferId={booking.transferId}
          currency={currency}
        />
      </div>
    </section>
  );
}
