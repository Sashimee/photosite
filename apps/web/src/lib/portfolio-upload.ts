import type { components } from '@photoo/api-client';

import { api } from './api';
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

const SCAN_POLL_INTERVAL_MS = 1500;
const SCAN_POLL_TIMEOUT_MS = 60_000;

function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(
          new PortfolioUploadError('apiError', `Upload failed with HTTP ${String(xhr.status)}`),
        );
      }
    };
    xhr.onerror = () => {
      reject(new PortfolioUploadError('apiError', 'Upload failed'));
    };
    xhr.send(file);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The attach endpoint (POST .../portfolio) 422s on anything but an already
// scanned upload (`isAttachableUploadStatus` in the API only accepts `clean`
// and `processed`), so this polls the upload itself until the virus scan
// clears rather than attaching straight after `complete` and surfacing that
// 422 to the photographer as a confusing error.
async function waitForScan(uploadId: string): Promise<void> {
  const deadline = Date.now() + SCAN_POLL_TIMEOUT_MS;
  for (;;) {
    const { data, error } = await api.GET('/v1/uploads/{id}', {
      params: { path: { id: uploadId } },
    });
    if (!data) {
      throw new PortfolioUploadError('apiError', 'Could not check the scan status', error);
    }
    if (data.status === 'clean' || data.status === 'processed') {
      return;
    }
    if (data.status === 'infected') {
      throw new PortfolioUploadError('infected', 'The file failed the virus scan');
    }
    if (data.status === 'failed') {
      throw new PortfolioUploadError('scanFailed', 'The scan could not complete');
    }
    if (Date.now() >= deadline) {
      throw new PortfolioUploadError('scanTimeout', 'The scan is taking too long');
    }
    await sleep(SCAN_POLL_INTERVAL_MS);
  }
}

// Uploads one portfolio image through the existing presigned flow (1A.3):
// request the upload, PUT the bytes, confirm completion, wait out the virus
// scan, then attach it to the portfolio. `onStageChange` lets the caller show
// a clear "scanning" state instead of treating the wait as an error, the same
// way the admin verification document viewer (1D.3) does.
export async function uploadPortfolioImage(
  file: File,
  handlers: {
    onProgress: (percent: number) => void;
    onStageChange: (stage: PortfolioUploadStage) => void;
  },
): Promise<PortfolioImage> {
  handlers.onStageChange('uploading');
  const created = await api.POST('/v1/uploads', {
    body: { purpose: 'portfolio', mimeType: file.type, sizeBytes: file.size },
  });
  if (!created.data) {
    throw new PortfolioUploadError('apiError', 'Could not start the upload', created.error);
  }

  await putWithProgress(created.data.url, file, created.data.headers, handlers.onProgress);

  const completed = await api.POST('/v1/uploads/{id}/complete', {
    params: { path: { id: created.data.uploadId } },
  });
  if (!completed.data) {
    throw new PortfolioUploadError('apiError', 'Could not confirm the upload', completed.error);
  }

  handlers.onStageChange('scanning');
  await waitForScan(completed.data.id);

  handlers.onStageChange('attaching');
  const attached = await api.POST('/v1/me/photographer-profile/portfolio', {
    body: { uploadId: completed.data.id },
  });
  if (!attached.data) {
    throw new PortfolioUploadError('apiError', 'Could not attach the image', attached.error);
  }
  return attached.data;
}
