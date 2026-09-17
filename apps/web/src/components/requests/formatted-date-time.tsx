'use client';

import type { Locale } from '@photoo/shared';

export function FormattedDateTime({
  value,
  locale,
  timeStyle,
}: {
  value: string;
  locale: Locale;
  timeStyle?: 'short';
}) {
  const formatted = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(timeStyle ? { timeStyle } : {}),
  }).format(new Date(value));

  // The server has no way to know the visitor's time zone, so the first
  // paint (server-rendered) and the client's own render can legitimately
  // differ; suppressing avoids a hydration warning for that one correction.
  return <span suppressHydrationWarning>{formatted}</span>;
}
