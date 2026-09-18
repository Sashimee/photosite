'use client';

import { FileText, Image as ImageIcon, Paperclip } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { components } from '@photoo/api-client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format-bytes';

type MessageAttachment = components['schemas']['MessageAttachment'];

const KIND_ICON = {
  image: ImageIcon,
  pdf: FileText,
  other: Paperclip,
} as const;

export function AttachmentChip({
  attachment,
  conversationId,
  messageId,
}: {
  attachment: MessageAttachment;
  conversationId: string;
  messageId: string;
}) {
  const t = useTranslations('web.messages.attachments');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const Icon = KIND_ICON[attachment.kind];

  async function open() {
    setStatus('loading');
    const { data } = await api.GET(
      '/v1/conversations/{id}/messages/{messageId}/attachments/{attachmentId}/download',
      { params: { path: { id: conversationId, messageId, attachmentId: attachment.id } } },
    );
    if (!data) {
      setStatus('error');
      return;
    }
    setStatus('idle');
    if (attachment.kind === 'image') {
      setPreviewUrl(data.url);
    } else {
      window.open(data.url, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-busy={status === 'loading'}
        onClick={() => void open()}
        className="gap-2"
      >
        <Icon aria-hidden="true" />
        <span>{formatBytes(attachment.sizeBytes)}</span>
        <span className="sr-only">
          {attachment.kind === 'image' ? t('viewCta') : t('downloadCta')}
        </span>
      </Button>
      {status === 'error' ? <p className="text-xs text-destructive">{t('openFailed')}</p> : null}
      <Dialog
        open={previewUrl !== null}
        onOpenChange={(next) => {
          if (!next) setPreviewUrl(null);
        }}
      >
        <DialogContent>
          <DialogTitle className="sr-only">{t('viewCta')}</DialogTitle>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the URL is short-lived and per-viewer, so it can't go through next/image's cache.
            <img
              src={previewUrl}
              alt={t('imageAlt')}
              className="max-h-[80vh] w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
