import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { isLocale, type Locale } from '@photoo/shared';

import { FormNotice } from '@/components/ui/form-message';
import { getSession } from '@/lib/session';

import { DashboardNav } from './dashboard-nav';

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;
  const signInHref = `/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/dashboard`)}`;

  const user = await getSession();
  if (!user) {
    redirect(signInHref);
  }

  const t = await getTranslations({ locale, namespace: 'web.dashboard' });

  if (!user.roles.includes('photographer')) {
    return (
      <section className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16">
        <h1 className="text-2xl font-semibold text-foreground">{t('needsRole.title')}</h1>
        <FormNotice tone="info">
          <p>{t('needsRole.description')}</p>
          <p>
            <Link href={`/${locale}/account`} className="font-medium underline underline-offset-4">
              {t('needsRole.cta')}
            </Link>
          </p>
        </FormNotice>
      </section>
    );
  }

  const links = [
    { href: `/${locale}/dashboard`, label: t('nav.overview') },
    { href: `/${locale}/dashboard/profile`, label: t('nav.profile') },
    { href: `/${locale}/dashboard/portfolio`, label: t('nav.portfolio') },
    { href: `/${locale}/dashboard/products`, label: t('nav.products') },
    { href: `/${locale}/dashboard/verification`, label: t('nav.verification') },
    { href: `/${locale}/dashboard/requests`, label: t('nav.requests') },
    { href: `/${locale}/dashboard/quotes`, label: t('nav.quotes') },
  ];

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <DashboardNav locale={locale} links={links} menuTitle={t('nav.menuTitle')} />
      {children}
    </section>
  );
}
