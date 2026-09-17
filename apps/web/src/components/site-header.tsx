import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

import { AccountMenu } from '@/components/account-menu';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { MobileNav, type NavLink } from '@/components/mobile-nav';
import { Wordmark } from '@/components/wordmark';
import { getSession } from '@/lib/session';

export async function SiteHeader({ locale }: { locale: Locale }) {
  const [t, tCommon, tLocale, tSwitcher, user] = await Promise.all([
    getTranslations({ locale, namespace: 'web.nav' }),
    getTranslations({ locale, namespace: 'common' }),
    getTranslations({ locale, namespace: 'locale' }),
    getTranslations({ locale, namespace: 'web.localeSwitcher' }),
    getSession(),
  ]);

  const links: NavLink[] = [
    { href: `/${locale}/photographers`, label: t('findPhotographer') },
    { href: `/${locale}/for-photographers`, label: t('forPhotographers') },
    { href: `/${locale}/jobs`, label: t('jobs') },
  ];

  const localeNames = Object.fromEntries(
    SUPPORTED_LOCALES.map((supported) => [supported, tLocale(supported)]),
  ) as Record<Locale, string>;

  const signInHref = `/${locale}/sign-in`;
  const accountHref = `/${locale}/account`;
  const authLink = {
    href: user ? accountHref : signInHref,
    label: user ? t('account') : t('signIn'),
  };

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Wordmark locale={locale} appName={tCommon('appName')} />
        <nav aria-label={t('menuTitle')} className="hidden items-center gap-6 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-foreground hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <LocaleSwitcher
            currentLocale={locale}
            label={tSwitcher('label')}
            localeNames={localeNames}
          />
          {user ? (
            <AccountMenu locale={locale} user={user} />
          ) : (
            <Link
              href={signInHref}
              className="text-sm font-medium text-foreground hover:text-primary"
            >
              {t('signIn')}
            </Link>
          )}
        </div>
        <MobileNav
          locale={locale}
          links={links}
          authLink={authLink}
          openLabel={t('openMenu')}
          closeLabel={t('closeMenu')}
          menuTitle={t('menuTitle')}
          switcherLabel={tSwitcher('label')}
          localeNames={localeNames}
        />
      </div>
    </header>
  );
}
