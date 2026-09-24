import type { UploadPurpose } from '@photoo/shared';

import { api } from './api';
import type { ApiErrorLike } from './request-errors';

export type PresignedUploadStage = 'uploading' | 'scanning';

export type PresignedUploadErrorKind = 'apiError' | 'infected' | 'scanFailed' | 'scanTimeout';

export class PresignedUploadError extends Error {
  readonly kind: PresignedUploadErrorKind;
  readonly apiError: ApiErrorLike | undefined;

  constructor(kind: PresignedUploadErrorKind, message: string, apiError?: ApiErrorLike) {
    super(message);
    this.name = 'PresignedUploadError';
    this.kind = kind;
    this.apiError = apiError;
  }
}

export interface ScannedUpload {
  id: string;
  status: 'clean' | 'processed';
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
          new PresignedUploadError('apiError', `Upload failed with HTTP ${String(xhr.status)}`),
        );
      }
    };
    xhr.onerror = () => {
      reject(new PresignedUploadError('apiError', 'Upload failed'));
    };
    xhr.send(file);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The attach/save endpoints 422 on anything but an already scanned upload
// (`isAttachableUploadStatus` only accepts `clean` and `processed`), so this
// polls the upload itself until the virus scan clears rather than moving on
// straight after `complete` and surfacing that 422 to the caller as a
// confusing error.
async function waitForScan(uploadId: string): Promise<ScannedUpload> {
  const deadline = Date.now() + SCAN_POLL_TIMEOUT_MS;
  for (;;) {
    const { data, error } = await api.GET('/v1/uploads/{id}', {
      params: { path: { id: uploadId } },
    });
    if (!data) {
      throw new PresignedUploadError('apiError', 'Could not check the scan status', error);
    }
    if (data.status === 'clean' || data.status === 'processed') {
      return { id: data.id, status: data.status };
    }
    if (data.status === 'infected') {
      throw new PresignedUploadError('infected', 'The file failed the virus scan');
    }
    if (data.status === 'failed') {
      throw new PresignedUploadError('scanFailed', 'The scan could not complete');
    }
    if (Date.now() >= deadline) {
      throw new PresignedUploadError('scanTimeout', 'The scan is taking too long');
    }
    await sleep(SCAN_POLL_INTERVAL_MS);
  }
}

// Runs the presigned-upload flow (1A.3) common to every purpose: request the
// upload, PUT the bytes, confirm completion, wait out the virus scan. Callers
// that need to attach the result somewhere (e.g. portfolio images) add that
// step themselves on top of the returned `ScannedUpload`; callers that only
// need the upload id (e.g. a profile's `logoUploadId` field) can use it as-is.
export async function uploadAndScanFile(
  file: File,
  purpose: UploadPurpose,
  handlers: {
    onProgress: (percent: number) => void;
    onStageChange: (stage: PresignedUploadStage) => void;
  },
): Promise<ScannedUpload> {
  handlers.onStageChange('uploading');
  const created = await api.POST('/v1/uploads', {
    body: { purpose, mimeType: file.type, sizeBytes: file.size },
  });
  if (!created.data) {
    throw new PresignedUploadError('apiError', 'Could not start the upload', created.error);
  }

  await putWithProgress(created.data.url, file, created.data.headers, handlers.onProgress);

  const completed = await api.POST('/v1/uploads/{id}/complete', {
    params: { path: { id: created.data.uploadId } },
  });
  if (!completed.data) {
    throw new PresignedUploadError('apiError', 'Could not confirm the upload', completed.error);
  }

  handlers.onStageChange('scanning');
  return waitForScan(completed.data.id);
}
