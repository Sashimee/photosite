'use client';

import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { useRef, useState } from 'react';

import { UPLOAD_PURPOSE_LIMITS } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import {
  PresignedUploadError,
  uploadAndScanFile,
  type PresignedUploadStage,
} from '@/lib/presigned-upload';
import { requestErrorMessage } from '@/lib/request-errors';

const LOGO_LIMITS = UPLOAD_PURPOSE_LIMITS.logo;

export function LogoUploadField({
  logoUrl,
  companyName,
  onChange,
}: {
  logoUrl: string | null;
  companyName: string;
  onChange: (uploadId: string | null | undefined) => void;
}) {
  const t = useTranslations('web.professional');
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<PresignedUploadStage | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [removed, setRemoved] = useState(false);

  function uploadErrorMessage(uploadError: unknown): string {
    if (uploadError instanceof PresignedUploadError) {
      if (uploadError.kind === 'apiError') {
        return requestErrorMessage(t, uploadError.apiError);
      }
      return t(`uploadErrors.${uploadError.kind}`);
    }
    return t('errors.generic');
  }

  function handleFileSelected(file: File | null) {
    if (!file) {
      return;
    }
    setError(null);
    setReady(false);
    if (!LOGO_LIMITS.mimeTypes.includes(file.type)) {
      setError(t('unsupportedType'));
      return;
    }
    if (file.size > LOGO_LIMITS.maxSizeBytes) {
      setError(t('tooLarge'));
      return;
    }

    setProgress(0);
    void uploadAndScanFile(file, 'logo', { onProgress: setProgress, onStageChange: setStage })
      .then((scanned) => {
        setStage(null);
        setRemoved(false);
        setReady(true);
        onChange(scanned.id);
      })
      .catch((uploadError: unknown) => {
        setStage(null);
        setError(uploadErrorMessage(uploadError));
      });
  }

  function handleRemove() {
    setRemoved(true);
    setReady(false);
    setError(null);
    onChange(null);
  }

  const showExisting = Boolean(logoUrl) && !removed;

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={inputRef}
        type="file"
        accept={LOGO_LIMITS.mimeTypes.join(',')}
        className="sr-only"
        onChange={(event) => {
          handleFileSelected(event.target.files?.[0] ?? null);
          event.target.value = '';
        }}
      />
      {showExisting && logoUrl ? (
        <div className="relative size-24 overflow-hidden rounded-md border border-border bg-muted">
          <Image
            src={logoUrl}
            alt={t('logoAlt', { companyName })}
            fill
            sizes="96px"
            className="object-contain"
          />
        </div>
      ) : (
        <div
          role="status"
          className="flex size-24 items-center justify-center rounded-md border border-dashed border-border px-2 text-center text-xs text-muted-foreground"
        >
          {removed ? t('logoWillBeRemoved') : t('logoEmpty')}
        </div>
      )}
      {stage ? (
        <p role="status" className="text-sm text-muted-foreground">
          {stage === 'uploading' ? t('uploading', { percent: progress }) : t('scanning')}
        </p>
      ) : null}
      {ready ? <FormNotice tone="success">{t('logoReady')}</FormNotice> : null}
      {error ? <FormNotice tone="error">{error}</FormNotice> : null}
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={stage !== null}
        >
          {showExisting ? t('logoReplaceCta') : t('logoUploadCta')}
        </Button>
        {showExisting ? (
          <Button type="button" variant="ghost" onClick={handleRemove} disabled={stage !== null}>
            {t('logoRemoveCta')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
