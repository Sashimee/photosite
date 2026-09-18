import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import Link from 'next/link';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { findOtherParticipant, participantDisplayName } from '@/lib/chat-participant';
import { formatRelativeTime } from '@/lib/relative-time';

type ConversationDto = components['schemas']['Conversation'];

const AVATAR_SIZE = 40;

function subjectLine(
  conversation: ConversationDto,
  t: (key: string, values?: Record<string, string | number | Date>) => string,
): string | null {
  if (conversation.subjectRef?.type === 'quote') {
    return conversation.subjectRef.requestTitle
      ? t('subjectQuote', { title: conversation.subjectRef.requestTitle })
      : t('subjectQuoteUntitled');
  }
  return null;
}

export async function ConversationList({
  conversations,
  currentUserId,
  locale,
}: {
  conversations: ConversationDto[];
  currentUserId: string;
  locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: 'web.messages.list' });
  const tParticipant = await getTranslations({ locale, namespace: 'web.messages.participant' });

  return (
    <ul className="flex flex-col gap-2">
      {conversations.map((conversation) => {
        const other = findOtherParticipant(conversation.participants, currentUserId);
        const name = other ? participantDisplayName(other, tParticipant('clientLabel')) : null;
        const subject = subjectLine(conversation, t);

        return (
          <li key={conversation.id} className="rounded-lg border border-border p-3">
            <Link
              href={`/${locale}/messages/${conversation.id}`}
              className="flex items-center gap-3"
            >
              {other?.user.avatarUrl ? (
                <Image
                  src={other.user.avatarUrl}
                  alt={name ?? ''}
                  width={AVATAR_SIZE}
                  height={AVATAR_SIZE}
                  className="size-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="size-10 shrink-0 rounded-full bg-muted" aria-hidden="true" />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-foreground">{name}</span>
                  {conversation.lastMessageAt ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(conversation.lastMessageAt, locale)}
                    </span>
                  ) : null}
                </div>
                {subject ? (
                  <p className="truncate text-xs text-muted-foreground">{subject}</p>
                ) : null}
                <p className="truncate text-sm text-muted-foreground">
                  {conversation.lastMessagePreview ?? t('noMessagesYet')}
                </p>
              </div>
              {conversation.unreadCount > 0 ? (
                <span
                  aria-label={t('unreadBadge', { count: conversation.unreadCount })}
                  className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground"
                >
                  {conversation.unreadCount}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
