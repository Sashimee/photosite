import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { resolveLocale } from '@photoo/shared';

import { resolveLocalizedText } from '../../lib/localized-text';
import { formatMoney, lowestPrice } from '../../lib/money';
import { TierQuoteButton } from './tier-quote-button';

type Product = components['schemas']['Product'];

export function ProductList({ products, slug }: { products: readonly Product[]; slug: string }) {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const sorted = [...products].sort((a, b) => a.order - b.order);

  return (
    <View className="gap-3 px-4" testID="product-list">
      <Text className="text-xl font-semibold text-foreground" accessibilityRole="header">
        {t('mobile.profile.productsHeading')}
      </Text>
      {sorted.length === 0 ? (
        <Text className="text-muted-foreground">{t('mobile.profile.noProducts')}</Text>
      ) : (
        sorted.map((product) => {
          const title = resolveLocalizedText(product.title, locale) ?? '';
          const description = resolveLocalizedText(product.description, locale);
          const lowest = lowestPrice(product.tiers.map((tier) => tier.price));
          return (
            <View
              key={product.id}
              className="gap-2 rounded-lg border border-border p-4"
              testID={`product-${product.id}`}
            >
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-base font-medium text-foreground">{title}</Text>
                <View className="rounded-full bg-secondary px-2 py-0.5">
                  <Text className="text-xs font-medium text-secondary-foreground">
                    {t(`common.categories.${product.category}`)}
                  </Text>
                </View>
              </View>
              {description ? (
                <Text className="text-sm text-muted-foreground">{description}</Text>
              ) : null}
              <Text className="text-sm text-muted-foreground">
                {t('mobile.profile.durationMinutes', { minutes: product.durationMinutes })}
              </Text>
              {lowest ? (
                <Text className="font-medium text-foreground">
                  {t('mobile.profile.fromPrice', { price: formatMoney(lowest, locale) })}
                </Text>
              ) : null}
              {product.tiers.map((tier) => {
                const usage = t(`common.licenceUsages.${tier.usage}`);
                return (
                  <View key={tier.id} className="flex-row items-center justify-between gap-2">
                    <View className="flex-1">
                      <Text className="text-sm text-foreground">{usage}</Text>
                      <Text className="text-sm text-muted-foreground">
                        {formatMoney(tier.price, locale)}
                      </Text>
                    </View>
                    <TierQuoteButton
                      slug={slug}
                      productId={product.id}
                      tierId={tier.id}
                      accessibilityLabel={t('mobile.profile.tierQuoteLabel', {
                        product: title,
                        usage,
                      })}
                    />
                  </View>
                );
              })}
            </View>
          );
        })
      )}
    </View>
  );
}
