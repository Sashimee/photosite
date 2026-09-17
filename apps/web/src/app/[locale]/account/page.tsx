import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { notFound, redirect } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { getSession } from '@/lib/session';

import { DangerZone } from './danger-zone';
import { RolesPanel } from './roles-panel';
import { SessionsPanel } from './sessions-panel';
import { TwoFactorPanel } from './two-factor-panel';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return {};
  }
  const t = await getTranslations({ locale, namespace: 'web.account' });
  return { title: t('title') };
}

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;

  const user = await getSession();
  if (!user) {
    redirect(`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/account`)}`);
  }

  const t = await getTranslations({ locale, namespace: 'web.account' });

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-10 px-4 py-16">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('signedInAs', { email: user.email })}</p>
      </div>
      <RolesPanel roles={user.roles} />
      <TwoFactorPanel twoFactorEnabled={user.twoFactorEnabled} />
      <SessionsPanel locale={locale} />
      <DangerZone locale={locale} />
    </section>
  );
}
