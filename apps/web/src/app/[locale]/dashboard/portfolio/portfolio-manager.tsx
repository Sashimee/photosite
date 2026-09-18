'use client';

import { ArrowDown, ArrowUp, ImageOff, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { useRef, useState } from 'react';

import type { components } from '@photoo/api-client';
import { UPLOAD_PURPOSE_LIMITS } from '@photoo/shared';

import { ConfirmActionButton } from '@/components/requests/confirm-action-button';
import { StatusBadge } from '@/components/requests/status-badge';
import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { api } from '@/lib/api';
import {
  PortfolioUploadError,
  uploadPortfolioImage,
  type PortfolioUploadStage,
} from '@/lib/portfolio-upload';
import { requestErrorMessage } from '@/lib/request-errors';

type PortfolioImage = components['schemas']['PortfolioImage'];

const PORTFOLIO_LIMITS = UPLOAD_PURPOSE_LIMITS.portfolio;

interface PendingUpload {
  localId: string;
  fileName: string;
  progress: number;
  stage: PortfolioUploadStage;
  error?: string;
}

function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [removed] = next.splice(index, 1);
  if (removed === undefined) {
    return next;
  }
  next.splice(target, 0, removed);
  return next;
}

export function PortfolioManager({ initialImages }: { initialImages: PortfolioImage[] }) {
  const t = useTranslations('web.dashboard.portfolio');
  const tStatus = useTranslations('web.dashboard.portfolio.status');
  const inputRef = useRef<HTMLInputElement>(null);

  const [images, setImages] = useState<PortfolioImage[]>(initialImages);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function uploadErrorMessage(error: unknown): string {
    if (error instanceof PortfolioUploadError) {
      if (error.kind === 'apiError') {
        return requestErrorMessage(t, error.apiError);
      }
      return t(`uploadErrors.${error.kind}`);
    }
    return t('errors.generic');
  }

  function startUpload(localId: string, file: File) {
    void uploadPortfolioImage(file, {
      onProgress: (progress) => {
        setPending((previous) =>
          previous.map((entry) => (entry.localId === localId ? { ...entry, progress } : entry)),
        );
      },
      onStageChange: (stage) => {
        setPending((previous) =>
          previous.map((entry) => (entry.localId === localId ? { ...entry, stage } : entry)),
        );
      },
    })
      .then((image) => {
        setImages((previous) => [...previous, image]);
        setPending((previous) => previous.filter((entry) => entry.localId !== localId));
      })
      .catch((error: unknown) => {
        setPending((previous) =>
          previous.map((entry) =>
            entry.localId === localId ? { ...entry, error: uploadErrorMessage(error) } : entry,
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
    let rejectedForSize = false;
    for (const file of selected) {
      if (!PORTFOLIO_LIMITS.mimeTypes.includes(file.type)) {
        rejectedForType = true;
        continue;
      }
      if (file.size > PORTFOLIO_LIMITS.maxSizeBytes) {
        rejectedForSize = true;
        continue;
      }
      accepted.push(file);
    }

    if (rejectedForType) {
      setFormError(t('unsupportedType'));
    } else if (rejectedForSize) {
      setFormError(t('tooLarge'));
    }

    const additions: PendingUpload[] = accepted.map((file) => ({
      localId: crypto.randomUUID(),
      fileName: file.name,
      progress: 0,
      stage: 'uploading',
    }));
    setPending((previous) => [...previous, ...additions]);
    accepted.forEach((file, index) => {
      const addition = additions[index];
      if (addition) {
        startUpload(addition.localId, file);
      }
    });
  }

  function dismissFailedUpload(localId: string) {
    setPending((previous) => previous.filter((entry) => entry.localId !== localId));
  }

  async function persistOrder(nextImages: PortfolioImage[]) {
    const previous = images;
    setReorderError(null);
    setImages(nextImages);
    const { data, error } = await api.PATCH('/v1/me/photographer-profile/portfolio/order', {
      body: { imageIds: nextImages.map((image) => image.id) },
    });
    if (!data) {
      setImages(previous);
      setReorderError(requestErrorMessage(t, error));
      return;
    }
    setImages(data.items);
  }

  function move(index: number, direction: -1 | 1) {
    void persistOrder(moveItem(images, index, direction));
  }

  async function deleteImage(imageId: string): Promise<boolean> {
    setDeleteError(null);
    setDeletingId(imageId);
    try {
      const { error } = await api.DELETE('/v1/me/photographer-profile/portfolio/{imageId}', {
        params: { path: { imageId } },
      });
      if (error) {
        setDeleteError(requestErrorMessage(t, error));
        return false;
      }
      setImages((previous) => previous.filter((image) => image.id !== imageId));
      return true;
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={PORTFOLIO_LIMITS.mimeTypes.join(',')}
        className="sr-only"
        onChange={(event) => {
          handleFilesSelected(event.target.files);
          event.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        className="gap-2 self-start"
      >
        <Upload aria-hidden="true" />
        {t('uploadCta')}
      </Button>
      {formError ? <FormNotice tone="error">{formError}</FormNotice> : null}
      {reorderError ? <FormNotice tone="error">{reorderError}</FormNotice> : null}

      {pending.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {pending.map((entry) => (
            <li
              key={entry.localId}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="truncate">{entry.fileName}</span>
              {entry.error ? (
                <span className="flex items-center gap-2 text-destructive">
                  {entry.error}
                  <button
                    type="button"
                    className="underline underline-offset-4"
                    onClick={() => {
                      dismissFailedUpload(entry.localId);
                    }}
                  >
                    {t('dismissCta')}
                  </button>
                </span>
              ) : (
                <span role="status" className="text-muted-foreground">
                  {entry.stage === 'uploading'
                    ? t('uploading', { percent: entry.progress })
                    : entry.stage === 'scanning'
                      ? t('scanning')
                      : t('attaching')}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {images.length === 0 && pending.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-3">
          {images.map((image, index) => (
            <li key={image.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              {image.url && image.width && image.height ? (
                <Image
                  src={image.url}
                  alt={t('imageAlt')}
                  width={image.width}
                  height={image.height}
                  sizes="(min-width: 640px) 33vw, 100vw"
                  className="aspect-square w-full rounded-md object-cover"
                />
              ) : (
                <div
                  role="status"
                  className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md bg-muted text-muted-foreground"
                >
                  <ImageOff aria-hidden="true" />
                  <span className="text-xs">{t('processing')}</span>
                </div>
              )}
              <StatusBadge label={tStatus(image.status)} muted={image.status !== 'approved'} />
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={index === 0}
                    aria-label={t('moveUpCta')}
                    onClick={() => {
                      move(index, -1);
                    }}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={index === images.length - 1}
                    aria-label={t('moveDownCta')}
                    onClick={() => {
                      move(index, 1);
                    }}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                </div>
                <ConfirmActionButton
                  triggerLabel={t('deleteCta')}
                  triggerVariant="outline"
                  title={t('deleteConfirmTitle')}
                  description={t('deleteConfirmDescription')}
                  confirmLabel={t('deleteConfirmCta')}
                  pendingLabel={t('deletePending')}
                  cancelLabel={t('deleteDismissCta')}
                  pending={deletingId === image.id}
                  error={deleteError}
                  onOpen={() => {
                    setDeleteError(null);
                  }}
                  onConfirm={() => deleteImage(image.id)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
