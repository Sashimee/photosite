import type { components } from '@photoo/api-client';

import { api } from './api';
import { PresignedUploadError, uploadAndScanFile } from './presigned-upload';
import type { ApiErrorLike } from './request-errors';

type PortfolioImage = components['schemas']['PortfolioImage'];

export type PortfolioUploadStage = 'uploading' | 'scanning' | 'attaching';

export type PortfolioUploadErrorKind = 'apiError' | 'infected' | 'scanFailed' | 'scanTimeout';

export class PortfolioUploadError extends Error {
  readonly kind: PortfolioUploadErrorKind;
  readonly apiError: ApiErrorLike | undefined;

  constructor(kind: PortfolioUploadErrorKind, message: string, apiError?: ApiErrorLike) {
    super(message);
    this.name = 'PortfolioUploadError';
    this.kind = kind;
    this.apiError = apiError;
  }
}

// Uploads one portfolio image through the shared presigned-upload flow
// (1A.3, lib/presigned-upload.ts), then attaches it to the portfolio.
// `onStageChange` lets the caller show a clear "scanning" state instead of
// treating the wait as an error, the same way the admin verification
// document viewer (1D.3) does.
export async function uploadPortfolioImage(
  file: File,
  handlers: {
    onProgress: (percent: number) => void;
    onStageChange: (stage: PortfolioUploadStage) => void;
  },
): Promise<PortfolioImage> {
  let scanned;
  try {
    scanned = await uploadAndScanFile(file, 'portfolio', {
      onProgress: handlers.onProgress,
      onStageChange: handlers.onStageChange,
    });
  } catch (error) {
    if (error instanceof PresignedUploadError) {
      throw new PortfolioUploadError(error.kind, error.message, error.apiError);
    }
    throw error;
  }

  handlers.onStageChange('attaching');
  const attached = await api.POST('/v1/me/photographer-profile/portfolio', {
    body: { uploadId: scanned.id },
  });
  if (!attached.data) {
    throw new PortfolioUploadError('apiError', 'Could not attach the image', attached.error);
  }
  return attached.data;
}
