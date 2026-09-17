import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { formatMoney, requireMoney } from '@/lib/money';

import { FormattedDateTime } from './formatted-date-time';
import { QuoteActions } from './quote-actions';
import { QuoteLineItems } from './quote-line-items';

type Quote = components['schemas']['Quote'];

// Only `sent` quotes are worth comparing side by side: drafts aren't
// visible to the client yet, and accepted/declined/expired/withdrawn ones
// are already resolved.
export async function QuoteCompare({
  quotes,
  locale,
  currentUserId,
}: {
  quotes: readonly Quote[];
  locale: Locale;
  currentUserId: string;
}) {
  const sentQuotes = quotes.filter((quote) => quote.status === 'sent');
  if (sentQuotes.length === 0) {
    return null;
  }

  const [tRequest, tQuote] = await Promise.all([
    getTranslations({ locale, namespace: 'web.requests.detail' }),
    getTranslations({ locale, namespace: 'web.quotes.detail' }),
  ]);

  return (
    <section className="flex flex-col gap-4" aria-labelledby="quote-compare-heading">
      <h2 id="quote-compare-heading" className="text-xl font-semibold text-foreground">
        {tRequest('compareHeading')}
      </h2>
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sentQuotes.map((quote) => {
          const total = requireMoney(quote.total, `quote "${quote.id}" total`);
          return (
            <li key={quote.id} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{formatMoney(total, locale)}</span>
                <span className="text-sm text-muted-foreground">
                  {tQuote('validUntilLabel')}{' '}
                  <FormattedDateTime value={quote.validUntil} locale={locale} timeStyle="short" />
                </span>
              </div>
              <QuoteLineItems
                lineItems={quote.lineItems}
                currency={total.currency}
                locale={locale}
              />
              {quote.message ? <p className="text-sm text-foreground">{quote.message}</p> : null}
              <Link
                href={`/${locale}/quotes/${quote.id}`}
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {tQuote('viewCta')}
              </Link>
              <QuoteActions quote={quote} currentUserId={currentUserId} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
