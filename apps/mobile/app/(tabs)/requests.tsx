import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import { resolveLocale } from '@photoo/shared';

import { PrimaryButton } from '../../src/components/form/primary-button';
import { ListFooter } from '../../src/components/requests/list-footer';
import { StatusBadge, TERMINAL_REQUEST_STATUSES } from '../../src/components/requests/status-badge';
import { RequireSession } from '../../src/components/require-session';
import { api } from '../../src/lib/api';
import { formatDateTime } from '../../src/lib/date-format';
import { useCursorList } from '../../src/lib/use-cursor-list';

type Request = components['schemas']['Request'];

const PAGE_SIZE = 20;

function RequestRow({ request }: { request: Request }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const locale = resolveLocale(i18n.language);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.push({ pathname: '/requests/[id]', params: { id: request.id } });
      }}
      testID={`request-row-${request.id}`}
      className="mx-6 mb-3 gap-2 rounded-lg border border-border p-4"
    >
      <View className="flex-row items-center justify-between gap-2">
        <StatusBadge
          testID={`request-row-status-${request.id}`}
          label={t(`mobile.requests.status.${request.status}`)}
          muted={TERMINAL_REQUEST_STATUSES.includes(request.status)}
        />
        <Text className="text-sm text-muted-foreground">
          {t('mobile.requests.list.quoteCount', { count: request.quoteCount })}
        </Text>
      </View>
      <Text className="text-base font-medium text-foreground">{request.title}</Text>
      <Text className="text-sm text-muted-foreground">
        {formatDateTime(request.eventDate, locale)}
      </Text>
    </Pressable>
  );
}

function RequestsList() {
  const { t } = useTranslation();
  const router = useRouter();

  const fetchPage = useCallback(async (cursor: string | undefined) => {
    const { data } = await api.GET('/v1/requests/mine', {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
    });
    if (!data) {
      throw new Error('requests/mine failed');
    }
    return data;
  }, []);

  const list = useCursorList(fetchPage);

  return (
    <View className="flex-1 bg-background pt-12">
      <View className="gap-3 px-6 pb-4">
        <Text className="text-2xl font-semibold text-foreground">
          {t('mobile.requests.list.title')}
        </Text>
        <PrimaryButton
          testID="requests-new"
          label={t('mobile.requests.list.newRequest')}
          onPress={() => {
            router.push('/requests/new');
          }}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push('/quotes');
          }}
          testID="requests-quotes"
          className="min-h-11 items-center justify-center"
        >
          <Text className="text-sm font-medium text-foreground underline">
            {t('mobile.requests.list.quotesReceived')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push('/bookings');
          }}
          testID="requests-bookings"
          className="min-h-11 items-center justify-center"
        >
          <Text className="text-sm font-medium text-foreground underline">
            {t('mobile.requests.list.bookings')}
          </Text>
        </Pressable>
      </View>
      {list.isLoading ? (
        <ActivityIndicator testID="requests-loading" />
      ) : (
        <FlatList
          testID="requests-list"
          data={list.items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <RequestRow request={item} />}
          refreshing={list.isRefreshing}
          onRefresh={() => void list.refresh()}
          onEndReached={list.onEndReached}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            list.failed ? null : (
              <Text className="px-6 text-center text-muted-foreground" testID="requests-empty">
                {t('mobile.requests.list.empty')}
              </Text>
            )
          }
          ListFooterComponent={
            <ListFooter
              testID="requests"
              failed={list.failed}
              loadingMore={list.isLoadingMore}
              failedLabel={t('mobile.requests.list.loadFailed')}
              retryLabel={t('mobile.requests.list.retry')}
              onRetry={() => void list.retry()}
            />
          }
        />
      )}
    </View>
  );
}

export default function RequestsScreen() {
  return (
    <RequireSession>
      <RequestsList />
    </RequireSession>
  );
}
