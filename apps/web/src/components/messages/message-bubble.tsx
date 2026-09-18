'use client';

import { FileText, Image as ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import type { PendingAttachment, PendingMessage } from '@/lib/use-conversation';
import { formatBytes } from '@/lib/format-bytes';

import { AttachmentChip } from './attachment-chip';
import { FormattedMessageTime } from './formatted-message-time';

type Message = components['schemas']['Message'];

const PENDING_KIND_ICON = {
  image: ImageIcon,
  application: FileText,
} as const;

function PendingAttachmentChip({ attachment }: { attachment: PendingAttachment }) {
  const Icon = attachment.mimeType.startsWith('image/')
    ? PENDING_KIND_ICON.image
    : PENDING_KIND_ICON.application;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
      <Icon aria-hidden="true" className="size-3" />
      {formatBytes(attachment.sizeBytes)}
    </span>
  );
}

interface BaseBubbleProps {
  isOwn: boolean;
  showSender: boolean;
  senderLabel: string;
  locale: Locale;
}

export type MessageBubbleProps =
  | (BaseBubbleProps & { kind: 'sent'; message: Message; conversationId: string })
  | (BaseBubbleProps & { kind: 'pending'; pending: PendingMessage; onRetry: () => void });

export function MessageBubble(props: MessageBubbleProps) {
  const t = useTranslations('web.messages.thread');
  const { isOwn, showSender, senderLabel, locale } = props;

  const createdAt = props.kind === 'sent' ? props.message.createdAt : props.pending.createdAt;
  const deleted = props.kind === 'sent' && props.message.deletedAt !== null;
  const body = props.kind === 'sent' ? props.message.body : props.pending.body;

  return (
    <div className={`flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
      {showSender ? (
        <span className="text-xs font-medium text-muted-foreground">{senderLabel}</span>
      ) : null}
      <div
        className={`flex max-w-[75%] flex-col gap-2 rounded-lg px-3 py-2 text-sm ${
          isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
        }`}
      >
        {deleted ? (
          <p className="italic opacity-80">{t('deletedMessage')}</p>
        ) : (
          <>
            {body ? <p className="whitespace-pre-wrap break-words">{body}</p> : null}
            {props.kind === 'sent' && props.message.attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {props.message.attachments.map((attachment) => (
                  <AttachmentChip
                    key={attachment.id}
                    attachment={attachment}
                    conversationId={props.conversationId}
                    messageId={props.message.id}
                  />
                ))}
              </div>
            ) : null}
            {props.kind === 'pending' &&
            props.pending.attachments &&
            props.pending.attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {props.pending.attachments.map((attachment) => (
                  <PendingAttachmentChip key={attachment.uploadId} attachment={attachment} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FormattedMessageTime value={createdAt} locale={locale} />
        {props.kind === 'pending' && props.pending.status === 'sending' ? (
          <span>{t('sendingStatus')}</span>
        ) : null}
        {props.kind === 'pending' && props.pending.status === 'failed' ? (
          <>
            <span className="text-destructive">{t('failedStatus')}</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={props.onRetry}
            >
              {t('retryCta')}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
