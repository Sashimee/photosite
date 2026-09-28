import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import type { Locale } from '@photoo/shared';

import { formatMoney } from '@/lib/money';

import type { Booking } from './booking-card';
import { BookingCheckout } from './booking-checkout';
import { BookingStatusTimeline } from './booking-status-timeline';
import { FormattedDateTime } from './formatted-date-time';

export async function BookingDetail({
  booking,
  locale,
  backHref,
  backLabel,
  checkoutReturnUrl,
}: {
  booking: Booking;
  locale: Locale;
  backHref: string;
  backLabel: string;
  checkoutReturnUrl?: string;
}) {
  const t = await getTranslations({ locale, namespace: 'web.bookings.detail' });
  const total = formatMoney(booking.total, locale);

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <Link
          href={backHref}
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          {backLabel}
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">{total}</h1>
        <BookingStatusTimeline status={booking.status} locale={locale} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2 font-medium text-foreground">
          <span>{t('totalLabel')}</span>
          <span>{total}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {booking.scheduledAt ? (
            <>
              {t('scheduleLabel')}{' '}
              <FormattedDateTime value={booking.scheduledAt} locale={locale} timeStyle="short" />
            </>
          ) : (
            t('notScheduled')
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('locationLabel')}{' '}
          {booking.location
            ? t('coordinates', { lat: booking.location.lat, lng: booking.location.lng })
            : t('noLocation')}
        </p>
      </div>

      {checkoutReturnUrl && booking.status === 'pending_payment' ? (
        <BookingCheckout bookingId={booking.id} returnUrl={checkoutReturnUrl} />
      ) : null}
    </section>
  );
}
