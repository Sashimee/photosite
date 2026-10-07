import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { resolveLocale } from '@photoo/shared';

import { PrimaryButton } from '../../../src/components/form/primary-button';
import {
  StudioFrame,
  StudioLoading,
  StudioMessage,
} from '../../../src/components/studio/studio-frame';
import { resolveLocalizedText } from '../../../src/lib/localized-text';
import { formatMoney, lowestPrice } from '../../../src/lib/money';
import { useOwnProducts } from '../../../src/lib/use-own-products';

type Product = components['schemas']['Product'];

function ProductRow({ product }: { product: Product }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = resolveLocale(i18n.language);
  const title = resolveLocalizedText(product.title, locale) ?? '';
  const lowest = lowestPrice(product.tiers.map((tier) => tier.price));

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.push({
          pathname: '/studio/products/[productId]',
          params: { productId: product.id },
        });
      }}
      testID={`product-row-${product.id}`}
      className="min-h-11 gap-1 rounded-md border border-border bg-card p-4"
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-base font-semibold text-foreground">{title}</Text>
        {product.isActive ? null : (
          <View className="rounded-full bg-secondary px-2 py-0.5">
            <Text
              className="text-xs font-medium text-secondary-foreground"
              testID={`product-inactive-${product.id}`}
            >
              {t('mobile.studio.products.inactiveLabel')}
            </Text>
          </View>
        )}
      </View>
      <Text className="text-sm text-muted-foreground">
        {t(`common.categories.${product.category}`)}
        {' · '}
        {t('mobile.studio.products.durationMinutes', { minutes: product.durationMinutes })}
      </Text>
      {lowest ? (
        <Text className="text-sm text-foreground">
          {t('mobile.studio.products.fromPrice', { price: formatMoney(lowest, locale) })}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ProductsBody() {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, reload } = useOwnProducts();

  if (state.status === 'loading') {
    return <StudioLoading testID="products-loading" />;
  }
  if (state.status === 'unauthorized') {
    return (
      <StudioMessage testID="products-unauthorized" message={t('mobile.studio.sessionExpired')} />
    );
  }
  if (state.status === 'error') {
    return (
      <StudioMessage
        testID="products-load-error"
        message={t('mobile.studio.loadFailed')}
        actionLabel={t('mobile.studio.retry')}
        actionTestID="products-retry"
        onAction={reload}
      />
    );
  }
  if (state.status === 'missing') {
    return (
      <StudioMessage
        testID="products-needs-profile"
        tone="info"
        message={`${t('mobile.studio.products.needsProfileTitle')}. ${t('mobile.studio.products.needsProfileDescription')}`}
        actionLabel={t('mobile.studio.products.needsProfileCta')}
        actionTestID="products-create-profile"
        onAction={() => {
          router.push('/studio/profile');
        }}
      />
    );
  }

  return (
    <ScrollView contentContainerClassName="gap-3 px-6 pb-12" testID="products-list">
      <Text className="text-muted-foreground">{t('mobile.studio.products.intro')}</Text>
      <PrimaryButton
        testID="products-new"
        label={t('mobile.studio.products.newCta')}
        onPress={() => {
          router.push('/studio/products/new');
        }}
      />
      {state.products.length === 0 ? (
        <Text className="text-center text-muted-foreground" testID="products-empty">
          {t('mobile.studio.products.empty')}
        </Text>
      ) : (
        state.products.map((product) => <ProductRow key={product.id} product={product} />)
      )}
    </ScrollView>
  );
}

export default function StudioProductsScreen() {
  const { t } = useTranslation();

  return (
    <StudioFrame title={t('mobile.studio.products.title')}>
      <ProductsBody />
    </StudioFrame>
  );
}
