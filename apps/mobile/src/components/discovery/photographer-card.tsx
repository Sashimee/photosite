import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { PHOTOGRAPHER_CATEGORIES, resolveLocale } from '@photoo/shared';

import { formatMoney } from '../../lib/money';

type PhotographerSummary = components['schemas']['PhotographerSummary'];

const AVATAR_SIZE = 56;

export function PhotographerCard({ photographer }: { photographer: PhotographerSummary }) {
  const { t, i18n } = useTranslation();
  const locale = resolveLocale(i18n.language);
  const fromPrice = formatMoney(photographer.startingPrice, locale);

  return (
    <View
      className="flex-row gap-3 border-b border-border p-4"
      testID={`photographer-card-${photographer.id}`}
    >
      {photographer.avatarUrl ? (
        <Image
          source={{ uri: photographer.avatarUrl }}
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: AVATAR_SIZE / 2,
            backgroundColor: '#f5f5f5',
          }}
          contentFit="cover"
          accessibilityLabel={t('mobile.discovery.results.avatarAlt', {
            displayName: photographer.displayName,
          })}
        />
      ) : (
        <View
          className="rounded-full bg-muted"
          style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
          accessibilityElementsHidden
        />
      )}
      <View className="flex-1 gap-1">
        <Text className="text-base font-medium text-foreground">{photographer.displayName}</Text>
        {photographer.headline ? (
          <Text className="text-sm text-muted-foreground" numberOfLines={2}>
            {photographer.headline}
          </Text>
        ) : null}
        <Text className="text-sm text-muted-foreground">{photographer.city}</Text>
        {photographer.categories.length > 0 ? (
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            {PHOTOGRAPHER_CATEGORIES.filter((category) =>
              photographer.categories.includes(category),
            ).map((category) => (
              <View key={category} className="rounded-full bg-secondary px-2 py-0.5">
                <Text className="text-xs font-medium text-secondary-foreground">
                  {t(`common.categories.${category}`)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <View className="flex-row items-center justify-between pt-1">
          {photographer.ratingCount > 0 ? (
            <Text className="text-sm text-foreground">
              {t('mobile.discovery.results.rating', {
                ratingAvg: photographer.ratingAvg,
                ratingCount: photographer.ratingCount,
              })}
            </Text>
          ) : (
            <View />
          )}
          {fromPrice ? (
            <Text className="text-sm font-medium text-foreground">
              {t('mobile.discovery.results.fromPrice', { price: fromPrice })}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
