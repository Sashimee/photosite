import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { formatTime } from '../../lib/date-format';
import type { PendingMessage } from '../../lib/use-conversation';
import { isImageMimeType, isScanningError } from '../../lib/chat-attachments';
import { AttachmentChip, formatBytes } from './attachment-chip';

type Message = components['schemas']['Message'];

interface BaseProps {
  isOwn: boolean;
  showSender: boolean;
  senderLabel: string;
  locale: Locale;
}

export type MessageBubbleProps =
  | (BaseProps & { kind: 'sent'; message: Message; conversationId: string })
  | (BaseProps & { kind: 'pending'; pending: PendingMessage; onRetry: () => void });

export function MessageBubble(props: MessageBubbleProps) {
  const { t } = useTranslation();
  const { isOwn, showSender, senderLabel, locale } = props;

  const createdAt = props.kind === 'sent' ? props.message.createdAt : props.pending.createdAt;
  const deleted = props.kind === 'sent' && props.message.deletedAt !== null;
  const body = props.kind === 'sent' ? props.message.body : props.pending.body;
  const testID =
    props.kind === 'sent' ? `message-${props.message.id}` : `pending-${props.pending.localId}`;

  return (
    <View className={`gap-1 px-4 py-1 ${isOwn ? 'items-end' : 'items-start'}`} testID={testID}>
      {showSender ? (
        <Text className="text-xs font-medium text-muted-foreground">{senderLabel}</Text>
      ) : null}
      <View
        className={`max-w-[80%] gap-2 rounded-lg px-3 py-2 ${isOwn ? 'bg-primary' : 'bg-muted'}`}
      >
        {deleted ? (
          <Text className="italic text-foreground opacity-80">
            {t('mobile.chat.thread.deletedMessage')}
          </Text>
        ) : (
          <>
            {body ? (
              <Text
                selectable
                dataDetectorType="none"
                className={isOwn ? 'text-primary-foreground' : 'text-foreground'}
              >
                {body}
              </Text>
            ) : null}
            {props.kind === 'sent'
              ? props.message.attachments.map((attachment) => (
                  <AttachmentChip
                    key={attachment.id}
                    attachment={attachment}
                    conversationId={props.conversationId}
                    messageId={props.message.id}
                  />
                ))
              : props.pending.attachments.map((attachment) => (
                  <Text
                    key={attachment.uploadId}
                    className={`text-xs ${isOwn ? 'text-primary-foreground' : 'text-foreground'}`}
                    testID={`pending-attachment-${attachment.uploadId}`}
                  >
                    {`${isImageMimeType(attachment.mimeType) ? t('mobile.chat.attachments.kindImage') : t('mobile.chat.attachments.kindPdf')} · ${attachment.name} · ${formatBytes(t, attachment.sizeBytes)}`}
                  </Text>
                ))}
          </>
        )}
      </View>
      <View className="flex-row items-center gap-2">
        <Text className="text-xs text-muted-foreground">{formatTime(createdAt, locale)}</Text>
        {props.kind === 'pending' && props.pending.status === 'sending' ? (
          <Text className="text-xs text-muted-foreground">
            {t('mobile.chat.thread.sendingStatus')}
          </Text>
        ) : null}
        {props.kind === 'pending' && props.pending.status === 'failed' ? (
          <>
            <Text
              className={`text-xs ${isScanningError(props.pending.error) ? 'text-muted-foreground' : 'text-destructive'}`}
            >
              {isScanningError(props.pending.error)
                ? t('mobile.chat.attachments.stillScanningStatus')
                : t('mobile.chat.thread.failedStatus')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={props.onRetry}
              testID={`retry-${props.pending.localId}`}
              className="min-h-11 justify-center"
            >
              <Text className="text-xs font-medium text-foreground underline">
                {t('mobile.chat.thread.retryCta')}
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}
