import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

import { env } from './env';

export function absoluteUrl(locale: Locale, path: string): string {
  return `${env.NEXT_PUBLIC_SITE_URL}/${locale}${path}`;
}

export function localeAlternates(path: string): Record<string, string> {
  return {
    ...Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, absoluteUrl(locale, path)])),
    'x-default': absoluteUrl(DEFAULT_LOCALE, path),
  };
}
