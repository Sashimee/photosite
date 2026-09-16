import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isLocale, type Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: requestedLocale } = await params;
  if (!isLocale(requestedLocale)) {
    notFound();
  }
  const locale: Locale = requestedLocale;

  const t = await getTranslations({ locale, namespace: 'web.home' });

  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-24 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
        {t('heroTitle')}
      </h1>
      <p className="text-lg text-muted-foreground text-balance">{t('heroSubtitle')}</p>
      <form
        action={`/${locale}/photographers`}
        method="get"
        className="flex w-full max-w-md flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="home-search" className="sr-only">
          {t('searchLabel')}
        </label>
        <input
          id="home-search"
          name="q"
          type="search"
          placeholder={t('searchPlaceholder')}
          className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <Button type="submit">{t('searchCta')}</Button>
      </form>
    </section>
  );
}
