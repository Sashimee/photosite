'use client';

import type { Locale } from '@photoo/shared';

export function FormattedMessageTime({ value, locale }: { value: string; locale: Locale }) {
  const formatted = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(value));

  // See components/requests/formatted-date-time.tsx: same time zone mismatch.
  return <span suppressHydrationWarning>{formatted}</span>;
}
