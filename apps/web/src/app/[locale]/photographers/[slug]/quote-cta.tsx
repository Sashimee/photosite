import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import type { Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';

export async function QuoteCta({ href, locale }: { href: string; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'web.profile' });

  return (
    <div>
      <Button asChild size="lg">
        <Link href={href}>{t('requestQuoteCta')}</Link>
      </Button>
    </div>
  );
}
