import type { Locale } from '@photoo/shared';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function formatRelativeTime(
  value: string,
  locale: Locale,
  now: number = Date.now(),
): string {
  const diffMs = new Date(value).getTime() - now;
  const absMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (absMs < MINUTE_MS) {
    return rtf.format(0, 'second');
  }
  if (absMs < HOUR_MS) {
    return rtf.format(Math.round(diffMs / MINUTE_MS), 'minute');
  }
  if (absMs < DAY_MS) {
    return rtf.format(Math.round(diffMs / HOUR_MS), 'hour');
  }
  if (absMs < WEEK_MS) {
    return rtf.format(Math.round(diffMs / DAY_MS), 'day');
  }
  return rtf.format(Math.round(diffMs / WEEK_MS), 'week');
}
