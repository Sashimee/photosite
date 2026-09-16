import Link from 'next/link';

import type { Locale } from '@photoo/shared';

export function Wordmark({ locale, appName }: { locale: Locale; appName: string }) {
  return (
    <Link href={`/${locale}`} className="text-lg font-semibold tracking-tight text-foreground">
      {appName}
    </Link>
  );
}
