import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { resolveLocale } from '@photoo/shared';

import { MessageBubble } from '../../src/components/chat/message-bubble';
import { NotificationPrompt } from '../../src/components/chat/notification-prompt';
import { MessageComposer } from '../../src/components/chat/message-composer';
import { FormNotice } from '../../src/components/form/form-notice';
import { RequireSession } from '../../src/components/require-session';
import { useAuth } from '../../src/lib/auth-context';
import { isScanningError } from '../../src/lib/chat-attachments';
import { findOtherParticipant, participantDisplayName } from '../../src/lib/chat-participant';
import { formatDay } from '../../src/lib/date-format';
import { groupMessages } from '../../src/lib/message-grouping';
import { requestErrorMessage } from '../../src/lib/request-errors';
import { useConversation, type PendingMessage } from '../../src/lib/use-conversation';
import { useNotificationPrompt } from '../../src/lib/use-notification-prompt';
import { useScreenVisible } from '../../src/lib/use-screen-visible';
import type { components } from '@photoo/api-client';

type Message = components['schemas']['Message'];

type Row =
  | { kind: 'sent'; key: string; senderId: string; createdAt: string; message: Message }
  | { kind: 'pending'; key: string; senderId: string; createdAt: string; pending: PendingMessage };

function BackButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.back();
      }}
      testID="thread-back"
      className="min-h-11 items-center justify-center"
    >
      <Text className="text-sm font-medium text-foreground underline">{label}</Text>
    </Pressable>
  );
}

function Thread({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const locale = resolveLocale(i18n.language);
  const visible = useScreenVisible();
  const chat = useConversation(id, visible);
  const notificationPrompt = useNotificationPrompt(
    chat.messages.length > 0 || chat.pending.length > 0,
  );
  const currentUserId = user?.id ?? '';
  const clientLabel = t('mobile.chat.participant.clientLabel');

  const other = chat.conversation
    ? findOtherParticipant(chat.conversation.participants, currentUserId)
    : undefined;
  const otherName = other ? participantDisplayName(other, clientLabel) : clientLabel;
  const typingName = other && chat.typingUserIds.includes(other.userId) ? otherName : null;

  const rows = useMemo(() => {
    const ascending: Row[] = [
      ...chat.messages.map((message): Row => ({
        kind: 'sent',
        key: message.id,
        senderId: message.senderId,
        createdAt: message.createdAt,
        message,
      })),
      ...chat.pending.map((pending): Row => ({
        kind: 'pending',
        key: pending.localId,
        senderId: currentUserId,
        createdAt: pending.createdAt,
        pending,
      })),
    ];
    const flags = groupMessages(ascending);
    return ascending.map((row, index) => ({ row, flag: flags[index] })).reverse();
  }, [chat.messages, chat.pending, currentUserId]);

  if (chat.loadState === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator testID="thread-loading" />
      </View>
    );
  }

  if (chat.loadState === 'notFound') {
    return (
      <View className="flex-1 justify-center gap-4 bg-background px-6">
        <FormNotice tone="error" testID="thread-not-found">
          {t('mobile.chat.thread.notFound')}
        </FormNotice>
        <BackButton label={t('mobile.chat.thread.back')} />
      </View>
    );
  }

  if (chat.loadState === 'failed' || !chat.conversation) {
    return (
      <View className="flex-1 justify-center gap-4 bg-background px-6">
        <View className="gap-1" testID="thread-error" accessibilityRole="alert">
          <Text className="text-sm text-destructive">{t('mobile.chat.thread.loadFailed')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void chat.reload()}
            testID="thread-retry"
            className="min-h-11 justify-center"
          >
            <Text className="text-sm font-medium text-foreground underline">
              {t('mobile.chat.thread.retry')}
            </Text>
          </Pressable>
        </View>
        <BackButton label={t('mobile.chat.thread.back')} />
      </View>
    );
  }

  const failedPending = chat.pending.find((entry) => entry.status === 'failed');

  return (
    <View className="flex-1 bg-background pt-12">
      <View className="flex-row items-center gap-3 px-4 pb-2">
        <BackButton label={t('mobile.chat.thread.back')} />
        <Text className="flex-1 text-lg font-semibold text-foreground" numberOfLines={1}>
          {otherName}
        </Text>
      </View>
      {chat.connectionState === 'disconnected' ? (
        <View className="px-4 pb-2">
          <FormNotice tone="info" testID="thread-reconnecting">
            {t('mobile.chat.thread.reconnecting')}
          </FormNotice>
        </View>
      ) : null}
      {notificationPrompt.visible ? (
        <NotificationPrompt
          onEnable={() => void notificationPrompt.enable()}
          onDismiss={() => void notificationPrompt.dismiss()}
        />
      ) : null}
      <FlatList
        testID="thread-list"
        inverted
        data={rows}
        keyExtractor={({ row }) => row.key}
        renderItem={({ item: { row, flag } }) => {
          const isOwn = row.senderId === currentUserId;
          const bubble =
            row.kind === 'sent' ? (
              <MessageBubble
                kind="sent"
                message={row.message}
                conversationId={id}
                isOwn={isOwn}
                showSender={!isOwn && (flag?.showSender ?? true)}
                senderLabel={otherName}
                locale={locale}
              />
            ) : (
              <MessageBubble
                kind="pending"
                pending={row.pending}
                isOwn
                showSender={false}
                senderLabel={clientLabel}
                locale={locale}
                onRetry={() => void chat.retryMessage(row.pending.localId)}
              />
            );
          return (
            <View>
              {flag?.isNewDay ? (
                <Text className="py-2 text-center text-xs text-muted-foreground">
                  {formatDay(row.createdAt, locale)}
                </Text>
              ) : null}
              {bubble}
            </View>
          );
        }}
        ListHeaderComponent={
          typingName ? (
            <Text className="px-4 py-1 text-xs text-muted-foreground" testID="thread-typing">
              {t('mobile.chat.thread.typingIndicator', { name: typingName })}
            </Text>
          ) : null
        }
        ListFooterComponent={
          chat.hasOlder ? (
            <View className="items-center py-3">
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: chat.loadingOlder }}
                disabled={chat.loadingOlder}
                onPress={() => void chat.loadOlder()}
                testID="thread-load-older"
                className="min-h-11 justify-center rounded-md border border-border px-4"
              >
                <Text className="text-sm font-medium text-foreground">
                  {chat.loadingOlder
                    ? t('mobile.chat.thread.loadingOlder')
                    : t('mobile.chat.thread.loadOlderCta')}
                </Text>
              </Pressable>
              {chat.olderFailed ? (
                <Text className="pt-1 text-xs text-destructive" accessibilityRole="alert">
                  {t('mobile.chat.thread.loadFailed')}
                </Text>
              ) : null}
            </View>
          ) : null
        }
      />
      {failedPending?.error ? (
        <View className="px-4 pb-1">
          <Text
            className={`text-xs ${isScanningError(failedPending.error) ? 'text-muted-foreground' : 'text-destructive'}`}
            testID="thread-send-error"
          >
            {isScanningError(failedPending.error)
              ? t('mobile.chat.attachments.stillScanning')
              : requestErrorMessage(
                  (key, values) =>
                    values ? t(`mobile.chat.${key}`, values) : t(`mobile.chat.${key}`),
                  failedPending.error,
                )}
          </Text>
        </View>
      ) : null}
      <MessageComposer onSend={chat.sendMessage} onTyping={chat.notifyTyping} />
    </View>
  );
}

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <RequireSession>
      <Thread id={id} />
    </RequireSession>
  );
}
