import type { components } from '@photoo/api-client';

import { api } from './api';
import { PresignedUploadError, uploadAndScanFile } from './presigned-upload';
import type { ApiErrorLike } from './request-errors';

type VerificationDocument = components['schemas']['VerificationDocument'];

export type VerificationDocumentUploadStage = 'uploading' | 'scanning' | 'attaching';

export type VerificationDocumentUploadErrorKind =
  'apiError' | 'infected' | 'scanFailed' | 'scanTimeout';

export class VerificationDocumentUploadError extends Error {
  readonly kind: VerificationDocumentUploadErrorKind;
  readonly apiError: ApiErrorLike | undefined;

  constructor(kind: VerificationDocumentUploadErrorKind, message: string, apiError?: ApiErrorLike) {
    super(message);
    this.name = 'VerificationDocumentUploadError';
    this.kind = kind;
    this.apiError = apiError;
  }
}

// Uploads one verification document through the shared presigned-upload flow
// (1A.3, lib/presigned-upload.ts), then attaches it to the current draft
// case under `documentKey`. Attaching replaces any document already
// occupying that key (verification.service.ts `attachDocument`), so this is
// the same call whether the slot is empty or being replaced.
export async function uploadVerificationDocument(
  file: File,
  documentKey: string,
  handlers: {
    onProgress: (percent: number) => void;
    onStageChange: (stage: VerificationDocumentUploadStage) => void;
  },
): Promise<VerificationDocument> {
  let scanned;
  try {
    scanned = await uploadAndScanFile(file, 'verification_document', {
      onProgress: handlers.onProgress,
      onStageChange: handlers.onStageChange,
    });
  } catch (error) {
    if (error instanceof PresignedUploadError) {
      throw new VerificationDocumentUploadError(error.kind, error.message, error.apiError);
    }
    throw error;
  }

  handlers.onStageChange('attaching');
  const attached = await api.POST('/v1/me/verification-case/documents', {
    body: { uploadId: scanned.id, documentKey },
  });
  if (!attached.data) {
    throw new VerificationDocumentUploadError(
      'apiError',
      'Could not attach the document',
      attached.error,
    );
  }
  return attached.data;
}
