import { getTranslations } from 'next-intl/server';

import type { BookingStatus, Locale } from '@photoo/shared';

import { cn } from '@/lib/utils';

const MAIN_STEPS: readonly BookingStatus[] = [
  'pending_payment',
  'paid_held',
  'in_progress',
  'delivered',
  'released',
];

const SIDE_EXIT_STATUSES: readonly BookingStatus[] = ['cancelled', 'refunded', 'disputed'];

export async function BookingStatusTimeline({
  status,
  locale,
}: {
  status: BookingStatus;
  locale: Locale;
}) {
  const [t, tStatus] = await Promise.all([
    getTranslations({ locale, namespace: 'web.bookings.detail' }),
    getTranslations({ locale, namespace: 'web.bookings.status' }),
  ]);

  if (SIDE_EXIT_STATUSES.includes(status)) {
    return (
      <div className="flex flex-col gap-2">
        <ol aria-label={t('statusTimelineLabel')} className="flex flex-wrap gap-x-2 gap-y-1">
          {MAIN_STEPS.map((step) => (
            <li key={step} className="text-sm text-muted-foreground line-through">
              {tStatus(step)}
            </li>
          ))}
        </ol>
        <p className="text-sm font-medium text-foreground" aria-current="step">
          {t('statusTimelineExited')} {tStatus(status)}
        </p>
      </div>
    );
  }

  const currentIndex = MAIN_STEPS.indexOf(status);

  return (
    <ol
      aria-label={t('statusTimelineLabel')}
      className="flex flex-wrap items-center gap-x-1 gap-y-1"
    >
      {MAIN_STEPS.map((step, index) => (
        <li key={step} className="flex items-center gap-1">
          <span
            aria-current={index === currentIndex ? 'step' : undefined}
            className={cn(
              'text-sm',
              index === currentIndex
                ? 'font-semibold text-foreground'
                : index < currentIndex
                  ? 'text-foreground'
                  : 'text-muted-foreground',
            )}
          >
            {tStatus(step)}
          </span>
          {index < MAIN_STEPS.length - 1 ? (
            <span aria-hidden="true" className="text-muted-foreground">
              &rarr;
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
