'use client';

import { FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { MAX_ATTACHMENTS_PER_MESSAGE, UPLOAD_PURPOSE_LIMITS } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { uploadChatAttachment } from '@/lib/chat-attachments';
import { formatBytes } from '@/lib/format-bytes';
import type { PendingAttachment } from '@/lib/use-conversation';

const CHAT_ATTACHMENT_LIMITS = UPLOAD_PURPOSE_LIMITS.chat_attachment;

interface PickerFile {
  localId: string;
  file: File;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  uploadId?: string;
  errorMessage?: string;
}

const KIND_ICON = {
  image: ImageIcon,
  application: FileText,
} as const;

function pickIcon(mimeType: string) {
  return mimeType.startsWith('image/') ? KIND_ICON.image : KIND_ICON.application;
}

export function AttachmentPicker({
  onChange,
  resetKey,
  disabled = false,
}: {
  onChange: (attachments: PendingAttachment[], busy: boolean) => void;
  resetKey: number;
  disabled?: boolean;
}) {
  const t = useTranslations('web.messages.attachments');
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PickerFile[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setFiles([]);
    setFormError(null);
  }, [resetKey]);

  useEffect(() => {
    const ready: PendingAttachment[] = files
      .filter(
        (entry): entry is PickerFile & { uploadId: string } =>
          entry.status === 'done' && !!entry.uploadId,
      )
      .map((entry) => ({
        uploadId: entry.uploadId,
        mimeType: entry.file.type,
        sizeBytes: entry.file.size,
      }));
    const busy = files.some((entry) => entry.status === 'uploading');
    onChange(ready, busy);
  }, [files]);

  function startUpload(localId: string, file: File) {
    void uploadChatAttachment(file, (progress) => {
      setFiles((previous) =>
        previous.map((entry) => (entry.localId === localId ? { ...entry, progress } : entry)),
      );
    })
      .then(({ uploadId }) => {
        setFiles((previous) =>
          previous.map((entry) =>
            entry.localId === localId
              ? { ...entry, status: 'done', uploadId, progress: 100 }
              : entry,
          ),
        );
      })
      .catch(() => {
        setFiles((previous) =>
          previous.map((entry) =>
            entry.localId === localId
              ? { ...entry, status: 'error', errorMessage: t('uploadFailed') }
              : entry,
          ),
        );
      });
  }

  function handleFilesSelected(selected: FileList | null) {
    if (!selected || selected.length === 0) {
      return;
    }
    setFormError(null);

    const accepted: File[] = [];
    let rejectedForType = false;
    for (const file of selected) {
      if (!CHAT_ATTACHMENT_LIMITS.mimeTypes.includes(file.type)) {
        rejectedForType = true;
        continue;
      }
      accepted.push(file);
    }

    const availableSlots = MAX_ATTACHMENTS_PER_MESSAGE - files.length;
    const withinLimit = accepted.slice(0, Math.max(0, availableSlots));

    if (rejectedForType) {
      setFormError(t('unsupportedType'));
    } else if (accepted.length > withinLimit.length) {
      setFormError(t('tooManyFiles', { max: MAX_ATTACHMENTS_PER_MESSAGE }));
    }

    const additions: PickerFile[] = withinLimit.map((file) => ({
      localId: crypto.randomUUID(),
      file,
      status: 'uploading',
      progress: 0,
    }));
    setFiles((previous) => [...previous, ...additions]);
    for (const addition of additions) {
      startUpload(addition.localId, addition.file);
    }
  }

  function removeFile(localId: string) {
    setFiles((previous) => previous.filter((entry) => entry.localId !== localId));
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={CHAT_ATTACHMENT_LIMITS.mimeTypes.join(',')}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          handleFilesSelected(event.target.files);
          event.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || files.length >= MAX_ATTACHMENTS_PER_MESSAGE}
        onClick={() => inputRef.current?.click()}
        className="self-start gap-2"
      >
        <Paperclip aria-hidden="true" />
        {t('attachCta')}
      </Button>
      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {files.map((entry) => {
            const Icon = pickIcon(entry.file.type);
            return (
              <li
                key={entry.localId}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm"
              >
                <Icon aria-hidden="true" className="size-4" />
                <span>{formatBytes(entry.file.size)}</span>
                {entry.status === 'uploading' ? (
                  <span className="text-muted-foreground" role="status">
                    {entry.progress}%
                  </span>
                ) : null}
                {entry.status === 'error' ? (
                  <span className="text-destructive">{entry.errorMessage}</span>
                ) : null}
                <button
                  type="button"
                  aria-label={t('removeCta')}
                  onClick={() => {
                    removeFile(entry.localId);
                  }}
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
