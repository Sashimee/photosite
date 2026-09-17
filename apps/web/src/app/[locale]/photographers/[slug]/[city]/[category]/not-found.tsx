import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { DEFAULT_LOCALE, isLocale } from '@photoo/shared';

import { Button } from '@/components/ui/button';

export default async function CategoryLandingNotFound({
  params,
}: {
  params?: Promise<{ locale: string }>;
}) {
  const resolved = await params;
  const locale = isLocale(resolved?.locale) ? resolved.locale : DEFAULT_LOCALE;

  const t = await getTranslations({ locale, namespace: 'web.landing.notFound' });

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
      <p className="text-muted-foreground">{t('description')}</p>
      <Button asChild>
        <Link href={`/${locale}/photographers`}>{t('backToSearch')}</Link>
      </Button>
    </section>
  );
}
