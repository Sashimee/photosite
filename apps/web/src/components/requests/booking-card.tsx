import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { formatMoney } from '@/lib/money';

import { FormattedDateTime } from './formatted-date-time';
import { isTerminalBookingStatus, StatusBadge } from './status-badge';

// Same fix as job-offers/job-offer-card.tsx: `location`'s generated type
// intersects `LatLng` with `Record<string, never> | null`, which a plain
// `{ lat, lng }` object never structurally satisfies.
export type Booking = Omit<components['schemas']['Booking'], 'location'> & {
  location: { lat: number; lng: number } | null;
};

export async function BookingCard({
  booking,
  locale,
  basePath,
}: {
  booking: Booking;
  locale: Locale;
  basePath?: string;
}) {
  const [t, tStatus] = await Promise.all([
    getTranslations({ locale, namespace: 'web.bookings.detail' }),
    getTranslations({ locale, namespace: 'web.bookings.status' }),
  ]);
  const total = formatMoney(booking.total, locale);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <Link
        href={`${basePath ?? `/${locale}/bookings`}/${booking.id}`}
        className="flex flex-col gap-2"
      >
        <div className="flex items-center justify-between gap-2">
          <StatusBadge
            label={tStatus(booking.status)}
            muted={isTerminalBookingStatus(booking.status)}
          />
          <span className="font-medium text-foreground">{total}</span>
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
      </Link>
    </li>
  );
}
