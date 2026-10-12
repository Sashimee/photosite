import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Text } from 'react-native';

import { ListFooter } from '../../src/components/requests/list-footer';
import { PublishedProfileGate } from '../../src/components/studio/published-profile-gate';
import { SentQuoteCard } from '../../src/components/studio/sent-quote-card';
import { StudioFrame, StudioMessage } from '../../src/components/studio/studio-frame';
import { api } from '../../src/lib/api';
import { useCursorList } from '../../src/lib/use-cursor-list';

const PAGE_SIZE = 20;

function SentQuotesList() {
  const { t } = useTranslation();
  const [unauthorized, setUnauthorized] = useState(false);

  const fetchPage = useCallback(async (cursor: string | undefined) => {
    const { data, response } = await api.GET('/v1/quotes/mine', {
      params: { query: { role: 'photographer', limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
    });
    if (!data) {
      if (response.status === 401) {
        setUnauthorized(true);
      }
      throw new Error(`quotes/mine failed: HTTP ${String(response.status)}`);
    }
    return data;
  }, []);

  const list = useCursorList(fetchPage);

  if (unauthorized) {
    return (
      <StudioMessage
        testID="sent-quotes-unauthorized"
        message={t('mobile.studio.sessionExpired')}
      />
    );
  }
  if (list.isLoading) {
    return <ActivityIndicator testID="sent-quotes-loading" />;
  }
  if (list.failed && list.items.length === 0) {
    return (
      <StudioMessage
        testID="sent-quotes-error"
        message={t('mobile.studio.loadFailed')}
        actionLabel={t('mobile.studio.retry')}
        actionTestID="sent-quotes-retry"
        onAction={() => void list.retry()}
      />
    );
  }

  return (
    <FlatList
      testID="sent-quotes-list"
      data={list.items}
      keyExtractor={(item) => item.id}
      contentContainerClassName="gap-3 px-6 pb-6"
      ListHeaderComponent={
        <Text className="pb-1 text-muted-foreground">{t('mobile.studio.quotes.intro')}</Text>
      }
      renderItem={({ item }) => (
        <SentQuoteCard
          quote={item}
          onWithdrawn={() => void list.refresh()}
          onUnauthorized={() => {
            setUnauthorized(true);
          }}
        />
      )}
      refreshing={list.isRefreshing}
      onRefresh={() => void list.refresh()}
      onEndReached={list.onEndReached}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        <Text className="text-center text-muted-foreground" testID="sent-quotes-empty">
          {t('mobile.studio.quotes.empty')}
        </Text>
      }
      ListFooterComponent={
        <ListFooter
          testID="sent-quotes"
          failed={list.failed}
          loadingMore={list.isLoadingMore}
          failedLabel={t('mobile.studio.quotes.loadMoreFailed')}
          retryLabel={t('mobile.studio.retry')}
          onRetry={() => void list.retry()}
        />
      }
    />
  );
}

export default function StudioQuotesScreen() {
  const { t } = useTranslation();

  return (
    <StudioFrame title={t('mobile.studio.quotes.title')}>
      <PublishedProfileGate scope="quotes">
        <SentQuotesList />
      </PublishedProfileGate>
    </StudioFrame>
  );
}
