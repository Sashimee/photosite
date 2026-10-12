import type { components } from '@photoo/api-client';

import { api } from './api';
import type { ApiErrorLike } from './auth-errors';
import {
  UploadError,
  isScanningError,
  prepareOriginalFile,
  uploadFile,
  type PickedFile,
  type UploadErrorKind,
} from './chat-attachments';

type PortfolioImage = components['schemas']['PortfolioImage'];

export type PortfolioUploadStage = 'uploading' | 'scanning' | 'attaching';

export type PortfolioUploadErrorKind = UploadErrorKind | 'apiError' | 'scanPending';

export class PortfolioUploadError extends Error {
  readonly kind: PortfolioUploadErrorKind;
  readonly apiError: ApiErrorLike | undefined;
  readonly uploadId: string | undefined;

  constructor(
    kind: PortfolioUploadErrorKind,
    message: string,
    options: { apiError?: ApiErrorLike | undefined; uploadId?: string | undefined } = {},
  ) {
    super(message);
    this.name = 'PortfolioUploadError';
    this.kind = kind;
    this.apiError = options.apiError;
    this.uploadId = options.uploadId;
  }
}

interface UploadHandlers {
  onProgress: (percent: number) => void;
  onStageChange: (stage: PortfolioUploadStage) => void;
}

export async function attachPortfolioImage(uploadId: string): Promise<PortfolioImage> {
  const { data, error, response } = await api.POST('/v1/me/photographer-profile/portfolio', {
    body: { uploadId },
  });
  if (data) {
    return data;
  }
  if (response.status === 422 && isScanningError(error)) {
    throw new PortfolioUploadError('scanPending', 'The upload is still being scanned', {
      apiError: error,
      uploadId,
    });
  }
  throw new PortfolioUploadError('apiError', 'Could not attach the image', {
    apiError: error,
    uploadId,
  });
}

export async function uploadPortfolioImage(
  file: PickedFile,
  handlers: UploadHandlers,
): Promise<PortfolioImage> {
  const prepared = await prepareOriginalFile(file, 'portfolio');
  let uploaded;
  try {
    uploaded = await uploadFile('portfolio', prepared, handlers);
  } catch (error) {
    if (error instanceof UploadError) {
      throw new PortfolioUploadError(error.kind, error.message, { apiError: error.apiError });
    }
    throw error;
  }
  handlers.onStageChange('attaching');
  return attachPortfolioImage(uploaded.uploadId);
}
