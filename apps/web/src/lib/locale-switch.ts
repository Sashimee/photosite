import type { Locale } from '@photoo/shared';

import { pathnameHasLocale } from './locale-routing';

export function buildLocaleSwitchHref(pathname: string, targetLocale: Locale): string {
  if (!pathnameHasLocale(pathname)) {
    return `/${targetLocale}`;
  }

  const segments = pathname.split('/');
  segments[1] = targetLocale;
  return segments.join('/') || `/${targetLocale}`;
}
