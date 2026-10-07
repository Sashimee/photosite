import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { useBookingsList, type BookingViewer } from '../../lib/use-bookings-list';
import { ListFooter } from '../requests/list-footer';
import { StudioMessage } from '../studio/studio-frame';
import { BookingCard } from './booking-card';

export function BookingsList({
  viewer,
  ownerId,
}: {
  viewer: BookingViewer;
  ownerId: string | null;
}) {
  const { t } = useTranslation();
  const { list, items, unauthorized } = useBookingsList(viewer, ownerId);
  const scope = viewer === 'client' ? 'mobile.bookings.list' : 'mobile.studio.bookings';
  const retryLabel = viewer === 'client' ? t(`${scope}.retry`) : t('mobile.studio.retry');
  const loadFailed = viewer === 'client' ? t(`${scope}.loadFailed`) : t('mobile.studio.loadFailed');
  const sessionExpired =
    viewer === 'client' ? t(`${scope}.sessionExpired`) : t('mobile.studio.sessionExpired');

  if (unauthorized) {
    return <StudioMessage testID="bookings-unauthorized" message={sessionExpired} />;
  }
  if (list.isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator testID="bookings-loading" />
      </View>
    );
  }
  if (list.failed && list.items.length === 0) {
    return (
      <StudioMessage
        testID="bookings-error"
        message={loadFailed}
        actionLabel={retryLabel}
        actionTestID="bookings-retry"
        onAction={() => void list.retry()}
      />
    );
  }

  return (
    <FlatList
      testID="bookings-list"
      data={items}
      keyExtractor={(item) => item.id}
      contentContainerClassName="gap-3 px-6 pb-6"
      ListHeaderComponent={
        <Text className="pb-1 text-muted-foreground">{t(`${scope}.intro`)}</Text>
      }
      renderItem={({ item }) => <BookingCard booking={item} viewer={viewer} />}
      refreshing={list.isRefreshing}
      onRefresh={() => void list.refresh()}
      onEndReached={list.onEndReached}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        list.hasMore || list.isLoadingMore ? null : (
          <Text className="text-center text-muted-foreground" testID="bookings-empty">
            {t(`${scope}.empty`)}
          </Text>
        )
      }
      ListFooterComponent={
        <ListFooter
          testID="bookings"
          failed={list.failed}
          loadingMore={list.isLoadingMore}
          failedLabel={
            viewer === 'client' ? t(`${scope}.loadFailed`) : t(`${scope}.loadMoreFailed`)
          }
          retryLabel={retryLabel}
          onRetry={() => void list.retry()}
        />
      }
    />
  );
}
