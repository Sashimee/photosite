import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { resolveLocale } from '@photoo/shared';

import { formatDateTime } from '../../lib/date-format';
import { formatMoney } from '../../lib/money';
import { StatusBadge, TERMINAL_QUOTE_STATUSES } from './status-badge';

type Quote = components['schemas']['Quote'];

export function QuoteCard({ quote }: { quote: Quote }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = resolveLocale(i18n.language);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.push({ pathname: '/quotes/[id]', params: { id: quote.id } });
      }}
      testID={`quote-card-${quote.id}`}
      className="gap-2 rounded-lg border border-border p-4"
    >
      <View className="flex-row items-center justify-between gap-2">
        <StatusBadge
          label={t(`mobile.quotes.status.${quote.status}`)}
          muted={TERMINAL_QUOTE_STATUSES.includes(quote.status)}
        />
        <Text className="font-medium text-foreground">{formatMoney(quote.total, locale)}</Text>
      </View>
      <Text className="text-base font-medium text-foreground">
        {quote.photographer.displayName}
      </Text>
      <Text className="text-sm text-muted-foreground">
        {t('mobile.quotes.card.validUntil', { date: formatDateTime(quote.validUntil, locale) })}
      </Text>
    </Pressable>
  );
}
