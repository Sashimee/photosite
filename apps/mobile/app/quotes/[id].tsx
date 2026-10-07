import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { resolveLocale } from '@photoo/shared';

import { FormNotice } from '../../src/components/form/form-notice';
import { QuoteActions } from '../../src/components/requests/quote-actions';
import { StatusBadge, TERMINAL_QUOTE_STATUSES } from '../../src/components/requests/status-badge';
import { RequireSession } from '../../src/components/require-session';
import { api } from '../../src/lib/api';
import { formatDateTime } from '../../src/lib/date-format';
import { formatMoney } from '../../src/lib/money';

type Quote = components['schemas']['Quote'];

type LoadState = 'loading' | 'ready' | 'notFound' | 'failed';
type Outcome = 'accepted' | 'declined';

function QuoteDetail({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = resolveLocale(i18n.language);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const { data, response } = await api.GET('/v1/quotes/{id}', { params: { path: { id } } });
      if (data) {
        setQuote(data);
        setLoadState('ready');
      } else {
        setLoadState(response.status === 404 || response.status === 403 ? 'notFound' : 'failed');
      }
    } catch {
      setLoadState('failed');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadState === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator testID="quote-detail-loading" />
      </View>
    );
  }

  if (loadState !== 'ready' || !quote) {
    return (
      <View className="flex-1 justify-center gap-4 bg-background px-6">
        {loadState === 'notFound' ? (
          <FormNotice tone="error" testID="quote-detail-not-found">
            {t('mobile.quotes.detail.notFound')}
          </FormNotice>
        ) : (
          <View className="gap-1" testID="quote-detail-error" accessibilityRole="alert">
            <Text className="text-sm text-destructive">{t('mobile.quotes.detail.loadFailed')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void load()}
              testID="quote-detail-retry"
              className="min-h-11 justify-center"
            >
              <Text className="text-sm font-medium text-foreground underline">
                {t('mobile.quotes.detail.retry')}
              </Text>
            </Pressable>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.back();
          }}
          testID="quote-detail-back"
          className="min-h-11 items-center justify-center"
        >
          <Text className="text-sm font-medium text-foreground underline">
            {t('mobile.quotes.detail.back')}
          </Text>
        </Pressable>
      </View>
    );
  }

  const { photographer } = quote;
  const currency = quote.total?.currency;

  return (
    <ScrollView contentContainerClassName="gap-5 px-6 py-12" testID="quote-detail">
      <View className="gap-2">
        <StatusBadge
          testID="quote-detail-status"
          label={t(`mobile.quotes.status.${quote.status}`)}
          muted={TERMINAL_QUOTE_STATUSES.includes(quote.status)}
        />
        <Text className="text-2xl font-semibold text-foreground">{photographer.displayName}</Text>
        {photographer.ratingCount > 0 ? (
          <Text className="text-sm text-muted-foreground">
            {t('mobile.quotes.detail.photographerRating', {
              ratingAvg: photographer.ratingAvg,
              ratingCount: photographer.ratingCount,
            })}
          </Text>
        ) : null}
      </View>

      <View className="gap-1">
        <Text className="text-sm text-muted-foreground">
          {t('mobile.quotes.detail.validUntilLabel')}
        </Text>
        <Text className="text-foreground">{formatDateTime(quote.validUntil, locale)}</Text>
      </View>

      <View className="gap-2" testID="quote-line-items">
        <Text className="text-lg font-semibold text-foreground">
          {t('mobile.quotes.detail.lineItemsHeading')}
        </Text>
        {quote.lineItems.map((item, index) => (
          <View key={`${item.label}-${String(index)}`} className="flex-row justify-between gap-3">
            <View className="flex-1">
              <Text className="text-foreground">{item.label}</Text>
              {currency ? (
                <Text className="text-sm text-muted-foreground">
                  {t('mobile.quotes.detail.lineItem', {
                    qty: item.qty,
                    unit: formatMoney({ amountCents: item.unitCents, currency }, locale),
                  })}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
        <View className="flex-row justify-between border-t border-border pt-2">
          <Text className="font-semibold text-foreground">
            {t('mobile.quotes.detail.totalLabel')}
          </Text>
          <Text className="font-semibold text-foreground" testID="quote-total">
            {formatMoney(quote.total, locale)}
          </Text>
        </View>
      </View>

      {quote.message ? (
        <View className="gap-1">
          <Text className="text-sm text-muted-foreground">
            {t('mobile.quotes.detail.messageHeading')}
          </Text>
          <Text className="text-foreground">{quote.message}</Text>
        </View>
      ) : null}

      {outcome ? (
        <FormNotice tone="success" testID="quote-outcome">
          {t(`mobile.quotes.detail.${outcome}Notice`)}
        </FormNotice>
      ) : null}
      {quote.status === 'withdrawn' ? (
        <FormNotice tone="info">{t('mobile.quotes.detail.withdrawnNotice')}</FormNotice>
      ) : null}
      {quote.status === 'expired' ? (
        <FormNotice tone="info">{t('mobile.quotes.detail.expiredNotice')}</FormNotice>
      ) : null}

      <QuoteActions
        quote={quote}
        onChanged={(next, action) => {
          setQuote(next);
          setOutcome(action === 'accept' ? 'accepted' : 'declined');
        }}
      />
    </ScrollView>
  );
}

export default function QuoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <RequireSession>
      <QuoteDetail id={id} />
    </RequireSession>
  );
}
