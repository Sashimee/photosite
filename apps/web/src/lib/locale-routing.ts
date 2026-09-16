import { resolveLocale, SUPPORTED_LOCALES } from '@photoo/shared';

export function pathnameHasLocale(pathname: string): boolean {
  return SUPPORTED_LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );
}

export function buildLocaleRedirectPath(
  pathname: string,
  search: string,
  acceptLanguage: string | null,
): string | null {
  if (pathnameHasLocale(pathname)) {
    return null;
  }

  const locale = resolveLocale(acceptLanguage ?? undefined);
  const suffix = pathname === '/' ? '' : pathname;
  return `/${locale}${suffix}${search}`;
}
