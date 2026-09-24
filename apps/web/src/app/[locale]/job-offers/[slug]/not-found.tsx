import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { DEFAULT_LOCALE, isLocale } from '@photoo/shared';

import { Button } from '@/components/ui/button';

// One state for every reason `GET /v1/job-offers/{slug}` returns 404 -
// expired, closed, taken down or never existed - because the public endpoint
// deliberately can't tell them apart and this page must not imply otherwise
// (docs/steps/1B.9-professional-area.md).
export default async function JobOfferNotFound({
  params,
}: {
  params?: Promise<{ locale: string }>;
}) {
  const resolved = await params;
  const locale = isLocale(resolved?.locale) ? resolved.locale : DEFAULT_LOCALE;

  const t = await getTranslations({ locale, namespace: 'web.jobBoard.notFound' });

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
      <p className="text-muted-foreground">{t('description')}</p>
      <Button asChild>
        <Link href={`/${locale}/job-offers`}>{t('backCta')}</Link>
      </Button>
    </section>
  );
}
