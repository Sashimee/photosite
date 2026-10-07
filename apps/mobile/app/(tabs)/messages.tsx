import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { SERVER_SOCKET_EVENTS, resolveLocale } from '@photoo/shared';

import { ConversationRow } from '../../src/components/chat/conversation-row';
import { ListFooter } from '../../src/components/requests/list-footer';
import { RequireSession } from '../../src/components/require-session';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth-context';
import { useChatSocket } from '../../src/lib/chat-socket';
import { useAppActive, useScreenVisible } from '../../src/lib/use-screen-visible';
import { useCursorList } from '../../src/lib/use-cursor-list';

const PAGE_SIZE = 20;

function ConversationList() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const locale = resolveLocale(i18n.language);
  const visible = useScreenVisible();
  const { socket } = useChatSocket(visible);

  const fetchPage = useCallback(async (cursor: string | undefined) => {
    const { data } = await api.GET('/v1/conversations', {
      params: { query: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) } },
    });
    if (!data) {
      throw new Error('conversations failed');
    }
    return data;
  }, []);

  const list = useCursorList(fetchPage);
  const { refresh } = list;

  const appActive = useAppActive();
  const wasAppActive = useRef(appActive);
  useEffect(() => {
    if (appActive && !wasAppActive.current) {
      void refresh();
    }
    wasAppActive.current = appActive;
  }, [appActive, refresh]);

  useEffect(() => {
    function handleUpdated() {
      void refresh();
    }
    socket.on(SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, handleUpdated);
    return () => {
      socket.off(SERVER_SOCKET_EVENTS.CONVERSATION_UPDATED, handleUpdated);
    };
  }, [socket, refresh]);

  return (
    <View className="flex-1 bg-background pt-12">
      <View className="px-6 pb-4">
        <Text className="text-2xl font-semibold text-foreground">
          {t('mobile.chat.list.title')}
        </Text>
      </View>
      {list.isLoading ? (
        <ActivityIndicator testID="conversations-loading" />
      ) : (
        <FlatList
          testID="conversations-list"
          data={list.items}
          keyExtractor={(item) => item.id}
          contentContainerClassName="gap-3 px-6 pb-6"
          renderItem={({ item }) => (
            <ConversationRow conversation={item} currentUserId={user?.id ?? ''} locale={locale} />
          )}
          refreshing={list.isRefreshing}
          onRefresh={() => void list.refresh()}
          onEndReached={list.onEndReached}
          onEndReachedThreshold={0.5}
          ListEmptyComponent={
            list.failed ? null : (
              <Text className="text-center text-muted-foreground" testID="conversations-empty">
                {t('mobile.chat.list.empty')}
              </Text>
            )
          }
          ListFooterComponent={
            <ListFooter
              testID="conversations"
              failed={list.failed}
              loadingMore={list.isLoadingMore}
              failedLabel={t('mobile.chat.list.loadFailed')}
              retryLabel={t('mobile.chat.list.retry')}
              onRetry={() => void list.retry()}
            />
          }
        />
      )}
    </View>
  );
}

export default function MessagesScreen() {
  return (
    <RequireSession>
      <ConversationList />
    </RequireSession>
  );
}
