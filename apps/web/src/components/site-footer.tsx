import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import type { Locale } from '@photoo/shared';

export async function SiteFooter({ locale }: { locale: Locale }) {
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale, namespace: 'web.footer' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);

  const links = [
    { href: `/${locale}/legal/imprint`, label: t('imprint') },
    { href: `/${locale}/legal/privacy`, label: t('privacy') },
    { href: `/${locale}/legal/terms`, label: t('terms') },
    { href: `/${locale}/legal/cookies`, label: t('cookies') },
    { href: `/${locale}/consent`, label: t('consentSettings') },
  ];

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>{t('rights', { year: new Date().getFullYear(), appName: tCommon('appName') })}</p>
        <nav aria-label={t('legalNav')} className="flex flex-wrap gap-4">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
