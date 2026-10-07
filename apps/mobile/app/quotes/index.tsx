import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { ListFooter } from '../../src/components/requests/list-footer';
import { QuoteCard } from '../../src/components/requests/quote-card';
import { RequireSession } from '../../src/components/require-session';
import { api } from '../../src/lib/api';
import { useCursorList } from '../../src/lib/use-cursor-list';

const PAGE_SIZE = 20;

function QuotesList() {
  const { t } = useTranslation();

  const fetchPage = useCallback(async (cursor: string | undefined) => {
    const { data } = await api.GET('/v1/quotes/mine', {
      params: { query: { role: 'client', limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
    });
    if (!data) {
      throw new Error('quotes/mine failed');
    }
    return data;
  }, []);

  const list = useCursorList(fetchPage);

  return (
    <View className="flex-1 bg-background pt-12">
      <View className="gap-1 px-6 pb-4">
        <Text className="text-2xl font-semibold text-foreground">
          {t('mobile.quotes.list.title')}
        </Text>
        <Text className="text-muted-foreground">{t('mobile.quotes.list.intro')}</Text>
      </View>
      {list.isLoading ? (
        <ActivityIndicator testID="quotes-loading" />
      ) : (
        <FlatList
          testID="quotes-list"
          data={list.items}
          keyExtractor={(item) => item.id}
          contentContainerClassName="gap-3 px-6 pb-6"
          renderItem={({ item }) => <QuoteCard quote={item} />}
          refreshing={list.isRefreshing}
          onRefresh={() => void list.refresh()}
          onEndReached={list.onEndReached}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            list.failed ? null : (
              <Text className="text-center text-muted-foreground" testID="quotes-empty">
                {t('mobile.quotes.list.empty')}
              </Text>
            )
          }
          ListFooterComponent={
            <ListFooter
              testID="quotes"
              failed={list.failed}
              loadingMore={list.isLoadingMore}
              failedLabel={t('mobile.quotes.list.loadFailed')}
              retryLabel={t('mobile.quotes.list.retry')}
              onRetry={() => void list.retry()}
            />
          }
        />
      )}
    </View>
  );
}

export default function QuotesScreen() {
  return (
    <RequireSession>
      <QuotesList />
    </RequireSession>
  );
}
