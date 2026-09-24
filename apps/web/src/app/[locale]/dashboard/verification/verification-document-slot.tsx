'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import type { components } from '@photoo/api-client';
import type { Locale } from '@photoo/shared';

import { Button } from '@/components/ui/button';
import { FormNotice } from '@/components/ui/form-message';
import { resolveLocalizedText } from '@/lib/localized-text';
import { requestErrorMessage } from '@/lib/request-errors';
import {
  VerificationDocumentUploadError,
  uploadVerificationDocument,
  type VerificationDocumentUploadStage,
} from '@/lib/verification-document-upload';

type RequiredDocument = components['schemas']['RequiredDocument'];
type VerificationDocument = components['schemas']['VerificationDocument'];

// Shown for a document that's been attached: only its type and scan
// outcome, never its contents or a link to it (docs/steps/1B.8-photographer-dashboard.md
// "the most sensitive thing a photographer sends us") - the photographer's
// own case response never carries a download URL at all (unlike the admin
// one), so there is nothing here that could leak one.
function documentStatusKey(document: VerificationDocument): string {
  switch (document.virusScanStatus) {
    case 'clean':
      return 'clean';
    case 'infected':
      return 'infected';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}

export function VerificationDocumentSlot({
  locale,
  requirement,
  document,
  readOnly,
  onUploaded,
}: {
  locale: Locale;
  requirement: RequiredDocument;
  document: VerificationDocument | null;
  readOnly: boolean;
  onUploaded: (document: VerificationDocument) => void;
}) {
  const t = useTranslations('web.dashboard.verification');
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<VerificationDocumentUploadStage | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function uploadErrorMessage(uploadError: unknown): string {
    if (uploadError instanceof VerificationDocumentUploadError) {
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
    if (!requirement.acceptedMimeTypes.includes(file.type)) {
      setError(t('unsupportedType'));
      return;
    }

    setProgress(0);
    void uploadVerificationDocument(file, requirement.key, {
      onProgress: setProgress,
      onStageChange: setStage,
    })
      .then((uploaded) => {
        setStage(null);
        onUploaded(uploaded);
      })
      .catch((uploadError: unknown) => {
        setStage(null);
        setError(uploadErrorMessage(uploadError));
      });
  }

  const label = resolveLocalizedText(requirement.label, locale)?.text ?? requirement.key;
  const busy = stage !== null;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-foreground">{label}</span>
        {requirement.description ? (
          <p className="text-sm text-muted-foreground">{requirement.description}</p>
        ) : null}
      </div>

      <p role="status" className="text-sm text-muted-foreground">
        {busy
          ? stage === 'uploading'
            ? t('uploading', { percent: progress })
            : stage === 'scanning'
              ? t('scanning')
              : t('attaching')
          : t(`documentStatus.${document ? documentStatusKey(document) : 'missing'}`)}
      </p>

      {error ? <FormNotice tone="error">{error}</FormNotice> : null}

      {readOnly ? null : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept={requirement.acceptedMimeTypes.join(',')}
            className="sr-only"
            onChange={(event) => {
              handleFileSelected(event.target.files?.[0] ?? null);
              event.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {document ? t('replaceCta') : t('uploadCta')}
          </Button>
        </>
      )}
    </li>
  );
}
