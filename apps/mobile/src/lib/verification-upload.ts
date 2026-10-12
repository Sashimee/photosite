import type { components } from '@photoo/api-client';

import { api } from './api';
import type { ApiErrorLike } from './auth-errors';
import {
  AttachmentRejectedError,
  UploadError,
  isImageMimeType,
  isScanningError,
  prepareFile,
  uploadFile,
  type PickedFile,
  type UploadErrorKind,
} from './chat-attachments';

type VerificationDocument = components['schemas']['VerificationDocument'];

export type VerificationUploadStage = 'uploading' | 'scanning' | 'attaching';

export type VerificationUploadErrorKind = UploadErrorKind | 'apiError' | 'scanPending';

const REENCODED_IMAGE_MIME_TYPE = 'image/jpeg';

export class VerificationUploadError extends Error {
  readonly kind: VerificationUploadErrorKind;
  readonly apiError: ApiErrorLike | undefined;
  readonly uploadId: string | undefined;

  constructor(
    kind: VerificationUploadErrorKind,
    message: string,
    options: { apiError?: ApiErrorLike | undefined; uploadId?: string | undefined } = {},
  ) {
    super(message);
    this.name = 'VerificationUploadError';
    this.kind = kind;
    this.apiError = options.apiError;
    this.uploadId = options.uploadId;
  }
}

interface UploadHandlers {
  onProgress: (percent: number) => void;
  onStageChange: (stage: VerificationUploadStage) => void;
}

export function isAcceptedForRequirement(
  file: PickedFile,
  acceptedMimeTypes: readonly string[],
): boolean {
  const isImage = file.mimeType === undefined || isImageMimeType(file.mimeType);
  const outgoing = isImage ? REENCODED_IMAGE_MIME_TYPE : file.mimeType;
  return outgoing !== undefined && acceptedMimeTypes.includes(outgoing);
}

export async function attachVerificationDocument(
  uploadId: string,
  documentKey: string,
): Promise<VerificationDocument> {
  const { data, error, response } = await api.POST('/v1/me/verification-case/documents', {
    body: { uploadId, documentKey },
  });
  if (data) {
    return data;
  }
  if (response.status === 422 && isScanningError(error)) {
    throw new VerificationUploadError('scanPending', 'The upload is still being scanned', {
      apiError: error,
      uploadId,
    });
  }
  throw new VerificationUploadError('apiError', 'Could not attach the document', {
    apiError: error,
    uploadId,
  });
}

export async function uploadVerificationDocument(
  file: PickedFile,
  requirement: { key: string; acceptedMimeTypes: readonly string[] },
  handlers: UploadHandlers,
): Promise<VerificationDocument> {
  if (!isAcceptedForRequirement(file, requirement.acceptedMimeTypes)) {
    throw new AttachmentRejectedError('unsupportedType');
  }
  const prepared = await prepareFile(file, 'verification_document');
  let uploaded;
  try {
    uploaded = await uploadFile('verification_document', prepared, handlers);
  } catch (error) {
    if (error instanceof UploadError) {
      throw new VerificationUploadError(error.kind, error.message, { apiError: error.apiError });
    }
    throw error;
  }
  handlers.onStageChange('attaching');
  return attachVerificationDocument(uploaded.uploadId, requirement.key);
}
