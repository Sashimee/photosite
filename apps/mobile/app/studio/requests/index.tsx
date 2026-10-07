import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, Text } from 'react-native';

import type { components } from '@photoo/api-client';

import { ListFooter } from '../../../src/components/requests/list-footer';
import { IncomingRequestSummary } from '../../../src/components/studio/incoming-request-summary';
import { PublishedProfileGate } from '../../../src/components/studio/published-profile-gate';
import { StudioFrame, StudioMessage } from '../../../src/components/studio/studio-frame';
import { api } from '../../../src/lib/api';
import { rememberIncomingRequests } from '../../../src/lib/incoming-request-store';
import { useCursorList } from '../../../src/lib/use-cursor-list';

type RequestSummary = components['schemas']['RequestSummary'];

const PAGE_SIZE = 20;

function IncomingRequestRow({ request }: { request: RequestSummary }) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.push({ pathname: '/studio/requests/[id]', params: { id: request.id } });
      }}
      testID={`incoming-request-${request.id}`}
      className="rounded-lg border border-border bg-card p-4"
    >
      <IncomingRequestSummary request={request} testIDPrefix={`incoming-request-${request.id}`} />
    </Pressable>
  );
}

function IncomingRequestsList() {
  const { t } = useTranslation();
  const [unauthorized, setUnauthorized] = useState(false);

  const fetchPage = useCallback(async (cursor: string | undefined) => {
    const { data, response } = await api.GET('/v1/requests', {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
    });
    if (!data) {
      if (response.status === 401) {
        setUnauthorized(true);
      }
      throw new Error(`requests failed: HTTP ${String(response.status)}`);
    }
    rememberIncomingRequests(data.items);
    return data;
  }, []);

  const list = useCursorList(fetchPage);

  if (unauthorized) {
    return (
      <StudioMessage
        testID="incoming-requests-unauthorized"
        message={t('mobile.studio.sessionExpired')}
      />
    );
  }
  if (list.isLoading) {
    return <ActivityIndicator testID="incoming-requests-loading" />;
  }
  if (list.failed && list.items.length === 0) {
    return (
      <StudioMessage
        testID="incoming-requests-error"
        message={t('mobile.studio.loadFailed')}
        actionLabel={t('mobile.studio.retry')}
        actionTestID="incoming-requests-retry"
        onAction={() => void list.retry()}
      />
    );
  }

  return (
    <FlatList
      testID="incoming-requests-list"
      data={list.items}
      keyExtractor={(item) => item.id}
      contentContainerClassName="gap-3 px-6 pb-6"
      ListHeaderComponent={
        <Text className="pb-1 text-muted-foreground">{t('mobile.studio.requests.intro')}</Text>
      }
      renderItem={({ item }) => <IncomingRequestRow request={item} />}
      refreshing={list.isRefreshing}
      onRefresh={() => void list.refresh()}
      onEndReached={list.onEndReached}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        <Text className="text-center text-muted-foreground" testID="incoming-requests-empty">
          {t('mobile.studio.requests.empty')}
        </Text>
      }
      ListFooterComponent={
        <ListFooter
          testID="incoming-requests"
          failed={list.failed}
          loadingMore={list.isLoadingMore}
          failedLabel={t('mobile.studio.requests.loadMoreFailed')}
          retryLabel={t('mobile.studio.retry')}
          onRetry={() => void list.retry()}
        />
      }
    />
  );
}

export default function StudioRequestsScreen() {
  const { t } = useTranslation();

  return (
    <StudioFrame title={t('mobile.studio.requests.title')}>
      <PublishedProfileGate scope="requests">
        <IncomingRequestsList />
      </PublishedProfileGate>
    </StudioFrame>
  );
}
