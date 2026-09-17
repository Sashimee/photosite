import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { formatMoney, requireMoney } from '@/lib/money';

import { FormattedDateTime } from './formatted-date-time';
import { QuotePhotographer } from './quote-photographer';
import { isTerminalQuoteStatus, StatusBadge } from './status-badge';

type Quote = components['schemas']['Quote'];

export async function QuoteCard({ quote, locale }: { quote: Quote; locale: Locale }) {
  const [t, tStatus, tProfile] = await Promise.all([
    getTranslations({ locale, namespace: 'web.quotes.detail' }),
    getTranslations({ locale, namespace: 'web.quotes.status' }),
    getTranslations({ locale, namespace: 'web.profile' }),
  ]);
  const total = formatMoney(requireMoney(quote.total, `quote "${quote.id}" total`), locale);
  const ratingLabel =
    quote.photographer.ratingCount > 0
      ? tProfile('rating', {
          ratingAvg: quote.photographer.ratingAvg,
          ratingCount: quote.photographer.ratingCount,
        })
      : null;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <Link href={`/${locale}/quotes/${quote.id}`} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge label={tStatus(quote.status)} muted={isTerminalQuoteStatus(quote.status)} />
          <span className="font-medium text-foreground">{total}</span>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('validUntilLabel')}{' '}
          <FormattedDateTime value={quote.validUntil} locale={locale} timeStyle="short" />
        </p>
        {quote.message ? <p className="text-sm text-foreground">{quote.message}</p> : null}
      </Link>
      <QuotePhotographer
        photographer={quote.photographer}
        locale={locale}
        ratingLabel={ratingLabel}
      />
    </li>
  );
}
