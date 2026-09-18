'use client';

import { useTranslations } from 'next-intl';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { FormattedDateTime } from '@/components/requests/formatted-date-time';
import { Button } from '@/components/ui/button';
import { findOtherParticipant, participantDisplayName } from '@/lib/chat-participant';
import { groupMessages } from '@/lib/message-grouping';
import { useConversation } from '@/lib/use-conversation';

import { ConnectionStatus } from './connection-status';
import { MessageBubble } from './message-bubble';
import { MessageComposer } from './message-composer';
import { TypingIndicator } from './typing-indicator';

type Message = components['schemas']['Message'];
type Conversation = components['schemas']['Conversation'];

export function Thread({
  conversationId,
  currentUserId,
  initialMessages,
  initialNextCursor,
  initialConversation,
  locale,
  clientLabel,
}: {
  conversationId: string;
  currentUserId: string;
  initialMessages: Message[];
  initialNextCursor: string | null;
  initialConversation: Conversation;
  locale: Locale;
  clientLabel: string;
}) {
  const t = useTranslations('web.messages.thread');
  const {
    conversation,
    messages,
    pending,
    connectionState,
    hasOlder,
    loadingOlder,
    loadOlder,
    sendMessage,
    retryMessage,
    typingUserIds,
    notifyTyping,
  } = useConversation({ conversationId, initialMessages, initialNextCursor, initialConversation });

  const otherParticipant = findOtherParticipant(conversation.participants, currentUserId);
  const otherName = otherParticipant ? participantDisplayName(otherParticipant, clientLabel) : null;
  const typingName =
    otherParticipant && typingUserIds.includes(otherParticipant.userId) ? otherName : null;

  const flags = groupMessages(messages);

  return (
    <div className="flex h-full flex-col">
      <ConnectionStatus state={connectionState} />
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {hasOlder ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-center"
            disabled={loadingOlder}
            aria-busy={loadingOlder}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? t('loadingOlder') : t('loadOlderCta')}
          </Button>
        ) : null}

        {messages.map((message, index) => {
          const flag = flags[index];
          const isOwn = message.senderId === currentUserId;
          const senderLabel =
            message.senderId === otherParticipant?.userId
              ? (otherName ?? clientLabel)
              : clientLabel;
          return (
            <div key={message.id} className="flex flex-col gap-1">
              {flag?.isNewDay ? (
                <p className="self-center text-xs text-muted-foreground">
                  <FormattedDateTime value={message.createdAt} locale={locale} />
                </p>
              ) : null}
              <MessageBubble
                kind="sent"
                message={message}
                conversationId={conversationId}
                isOwn={isOwn}
                showSender={!isOwn && (flag?.showSender ?? true)}
                senderLabel={senderLabel}
                locale={locale}
              />
            </div>
          );
        })}

        {pending.map((entry) => (
          <MessageBubble
            key={entry.localId}
            kind="pending"
            pending={entry}
            isOwn
            showSender={false}
            senderLabel={clientLabel}
            locale={locale}
            onRetry={() => void retryMessage(entry.localId)}
          />
        ))}

        <TypingIndicator name={typingName} />
      </div>
      <MessageComposer onSend={sendMessage} onTyping={notifyTyping} />
    </div>
  );
}
