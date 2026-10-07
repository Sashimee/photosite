import type { Locale } from '@photoo/shared';

export function formatDateTime(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    typeof value === 'string' ? new Date(value) : value,
  );
}

export function formatDay(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    typeof value === 'string' ? new Date(value) : value,
  );
}

export function formatTime(value: string | Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(
    typeof value === 'string' ? new Date(value) : value,
  );
}
