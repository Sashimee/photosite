import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('admin.notFound');

  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold text-foreground">{t('title')}</h1>
      <p className="text-muted-foreground">{t('description')}</p>
      <Link href="/" className={buttonVariants({})}>
        {t('backCta')}
      </Link>
    </section>
  );
}
