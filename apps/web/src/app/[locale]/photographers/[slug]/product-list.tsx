import { getTranslations } from 'next-intl/server';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { resolveLocalizedText } from '@/lib/localized-text';
import { formatMoney, lowestPrice, requireMoney } from '@/lib/money';

type Product = components['schemas']['Product'];

export async function ProductList({
  products,
  locale,
}: {
  products: readonly Product[];
  locale: Locale;
}) {
  const [t, tCategories, tLicenceUsages] = await Promise.all([
    getTranslations({ locale, namespace: 'web.profile' }),
    getTranslations({ locale, namespace: 'common.categories' }),
    getTranslations({ locale, namespace: 'common.licenceUsages' }),
  ]);

  const sorted = [...products].sort((a, b) => a.order - b.order);

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-xl font-semibold text-foreground">{t('productsHeading')}</h2>
      {sorted.length === 0 ? (
        <p className="text-muted-foreground">{t('noProducts')}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {sorted.map((product) => {
            const title = resolveLocalizedText(product.title, locale);
            const description = resolveLocalizedText(product.description, locale);
            const from = formatMoney(
              requireMoney(
                lowestPrice(product.tiers.map((tier) => tier.price)),
                `product "${product.id}"`,
              ),
              locale,
            );

            return (
              <li
                key={product.id}
                className="flex flex-col gap-3 rounded-lg border border-border p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3
                    className="font-medium text-foreground"
                    {...(title && title.locale !== locale ? { lang: title.locale } : {})}
                  >
                    {title?.text ?? ''}
                  </h3>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                    {tCategories(product.category)}
                  </span>
                </div>
                {description ? (
                  <p
                    className="text-sm text-muted-foreground"
                    {...(description.locale !== locale ? { lang: description.locale } : {})}
                  >
                    {description.text}
                  </p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  {t('durationMinutes', { minutes: product.durationMinutes })}
                </p>
                <p className="font-medium text-foreground">{t('fromPrice', { price: from })}</p>
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {product.tiers.map((tier) => {
                    const price = formatMoney(
                      requireMoney(tier.price, `product "${product.id}" tier "${tier.id}"`),
                      locale,
                    );
                    return (
                      <li key={tier.id} className="flex items-center justify-between gap-2">
                        <span>{tLicenceUsages(tier.usage)}</span>
                        <span>{price}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
