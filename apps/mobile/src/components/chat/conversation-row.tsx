import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { findOtherParticipant, participantDisplayName } from '../../lib/chat-participant';
import { formatDay } from '../../lib/date-format';

type Conversation = components['schemas']['Conversation'];

export function ConversationRow({
  conversation,
  currentUserId,
  locale,
}: {
  conversation: Conversation;
  currentUserId: string;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  const other = findOtherParticipant(conversation.participants, currentUserId);
  const name = other
    ? participantDisplayName(other, t('mobile.chat.participant.clientLabel'))
    : t('mobile.chat.participant.clientLabel');
  const subject = conversation.subjectRef
    ? conversation.subjectRef.requestTitle
      ? t('mobile.chat.list.subjectQuote', { title: conversation.subjectRef.requestTitle })
      : t('mobile.chat.list.subjectQuoteUntitled')
    : null;
  const avatarUrl = other?.user.avatarUrl ?? null;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.push(`/messages/${conversation.id}`);
      }}
      testID={`conversation-${conversation.id}`}
      className="min-h-16 flex-row items-center gap-3 rounded-lg border border-border bg-background p-3"
    >
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: 44, height: 44, borderRadius: 22 }}
          accessibilityLabel={name}
        />
      ) : (
        <View className="size-11 items-center justify-center rounded-full bg-muted">
          <Text className="text-base font-medium text-foreground">
            {name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-base font-medium text-foreground" numberOfLines={1}>
            {name}
          </Text>
          {conversation.lastMessageAt ? (
            <Text className="text-xs text-muted-foreground">
              {formatDay(conversation.lastMessageAt, locale)}
            </Text>
          ) : null}
        </View>
        {subject ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {subject}
          </Text>
        ) : null}
        <Text className="text-sm text-muted-foreground" numberOfLines={1}>
          {conversation.lastMessagePreview ?? t('mobile.chat.list.noMessagesYet')}
        </Text>
      </View>
      {conversation.unreadCount > 0 ? (
        <View
          accessible
          accessibilityLabel={t('mobile.chat.list.unreadBadge', {
            count: conversation.unreadCount,
          })}
          testID={`conversation-unread-${conversation.id}`}
          className="min-w-6 items-center rounded-full bg-destructive px-2 py-0.5"
        >
          <Text className="text-xs font-medium text-destructive-foreground">
            {conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
