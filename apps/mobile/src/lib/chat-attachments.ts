import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  UPLOAD_PURPOSE_LIMITS,
  type UploadPurpose,
} from '@photoo/shared';

import { api } from './api';
import type { ApiErrorLike } from './auth-errors';

export interface PendingAttachment {
  uploadId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
}

export interface PreparedFile {
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
}

export type AttachmentRejection = 'unsupportedType' | 'tooLarge';

export type UploadStage = 'uploading' | 'scanning';

export type UploadErrorKind = 'upload' | 'infected' | 'scanFailed' | 'scanTimeout';

export type ChatUploadErrorKind = UploadErrorKind;

export class UploadError extends Error {
  readonly kind: UploadErrorKind;
  readonly apiError: ApiErrorLike | undefined;

  constructor(kind: UploadErrorKind, message: string, apiError?: ApiErrorLike) {
    super(message);
    this.name = 'UploadError';
    this.kind = kind;
    this.apiError = apiError;
  }
}

export { UploadError as ChatUploadError };

export class AttachmentRejectedError extends Error {
  readonly reason: AttachmentRejection;

  constructor(reason: AttachmentRejection) {
    super(`Attachment rejected: ${reason}`);
    this.name = 'AttachmentRejectedError';
    this.reason = reason;
  }
}

const LIMITS = UPLOAD_PURPOSE_LIMITS.chat_attachment;
const ALLOWED_MIME_TYPES: readonly string[] = LIMITS.mimeTypes;

export interface UploadedFile {
  uploadId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export const MAX_ATTACHMENTS = MAX_ATTACHMENTS_PER_MESSAGE;
export const MAX_ATTACHMENT_BYTES = LIMITS.maxSizeBytes;
export const MAX_IMAGE_EDGE_PX = 2048;
const RESIZED_JPEG_QUALITY = 0.8;
const SCAN_POLL_INTERVAL_MS = 1500;
const SCAN_POLL_TIMEOUT_MS = 60_000;

export function isAllowedAttachmentType(mimeType: string | undefined): boolean {
  return mimeType !== undefined && ALLOWED_MIME_TYPES.includes(mimeType);
}

export function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function isScanningError(error: ApiErrorLike | undefined): boolean {
  // The API reports an unscanned attachment as a plain 422 with no distinct
  // code, so the message is the only way to tell it from an invalid attachment.
  return error?.code === 'UNPROCESSABLE_ENTITY' && /scanning/i.test(error.message ?? '');
}

async function readDimensions(file: PickedFile): Promise<{ width: number; height: number }> {
  if (file.width && file.height) {
    return { width: file.width, height: file.height };
  }
  const probe = await ImageManipulator.manipulate(file.uri).renderAsync();
  return { width: probe.width, height: probe.height };
}

async function reencodeAsJpeg(file: PickedFile): Promise<PickedFile> {
  const { width, height } = await readDimensions(file);
  const context = ImageManipulator.manipulate(file.uri);
  const longEdge = Math.max(width, height);
  const resized =
    longEdge > MAX_IMAGE_EDGE_PX
      ? context.resize(
          width >= height ? { width: MAX_IMAGE_EDGE_PX } : { height: MAX_IMAGE_EDGE_PX },
        )
      : context;
  const rendered = await resized.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: RESIZED_JPEG_QUALITY,
  });
  const baseName = file.name.replace(/\.[^./]+$/, '');
  return {
    uri: saved.uri,
    name: `${baseName}.jpg`,
    mimeType: 'image/jpeg',
    width: saved.width,
    height: saved.height,
  };
}

async function readBlob(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  return response.blob();
}

export async function prepareFile(file: PickedFile): Promise<PreparedFile> {
  const isImage = file.mimeType === undefined || isImageMimeType(file.mimeType);
  if (!isImage && !isAllowedAttachmentType(file.mimeType)) {
    throw new AttachmentRejectedError('unsupportedType');
  }

  let candidate = file;
  let blob = await readBlob(file.uri);
  if (isImage) {
    candidate = await reencodeAsJpeg(file);
    blob = await readBlob(candidate.uri);
  }

  if (blob.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentRejectedError('tooLarge');
  }
  return {
    uri: candidate.uri,
    name: candidate.name,
    mimeType: candidate.mimeType ?? 'image/jpeg',
    sizeBytes: blob.size,
    blob,
  };
}

export async function prepareOriginalFile(
  file: PickedFile,
  purpose: UploadPurpose,
): Promise<PreparedFile> {
  const limits = UPLOAD_PURPOSE_LIMITS[purpose];
  if (file.mimeType === undefined || !limits.mimeTypes.includes(file.mimeType)) {
    throw new AttachmentRejectedError('unsupportedType');
  }
  const blob = await readBlob(file.uri);
  if (blob.size > limits.maxSizeBytes) {
    throw new AttachmentRejectedError('tooLarge');
  }
  return {
    uri: file.uri,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: blob.size,
    blob,
  };
}

function putWithProgress(
  url: string,
  blob: Blob,
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
        reject(new UploadError('upload', `Upload failed with HTTP ${String(xhr.status)}`));
      }
    };
    xhr.onerror = () => {
      reject(new UploadError('upload', 'Upload failed'));
    };
    xhr.send(blob);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForScan(uploadId: string): Promise<void> {
  const deadline = Date.now() + SCAN_POLL_TIMEOUT_MS;
  for (;;) {
    const { data, error } = await api.GET('/v1/uploads/{id}', {
      params: { path: { id: uploadId } },
    });
    if (!data) {
      throw new UploadError('upload', 'Could not check the scan status', error);
    }
    if (data.status === 'clean' || data.status === 'processed') {
      return;
    }
    if (data.status === 'infected') {
      throw new UploadError('infected', 'The file failed the virus scan');
    }
    if (data.status === 'failed') {
      throw new UploadError('scanFailed', 'The scan could not complete');
    }
    if (Date.now() >= deadline) {
      throw new UploadError('scanTimeout', 'The scan is taking too long');
    }
    await sleep(SCAN_POLL_INTERVAL_MS);
  }
}

export async function uploadFile(
  purpose: UploadPurpose,
  file: PreparedFile,
  handlers: { onProgress: (percent: number) => void; onStageChange: (stage: UploadStage) => void },
): Promise<UploadedFile> {
  handlers.onStageChange('uploading');
  const created = await api.POST('/v1/uploads', {
    body: { purpose, mimeType: file.mimeType, sizeBytes: file.sizeBytes },
  });
  if (!created.data) {
    throw new UploadError('upload', 'Could not start the upload', created.error);
  }

  await putWithProgress(created.data.url, file.blob, created.data.headers, handlers.onProgress);

  const completed = await api.POST('/v1/uploads/{id}/complete', {
    params: { path: { id: created.data.uploadId } },
  });
  if (!completed.data) {
    throw new UploadError('upload', 'Could not confirm the upload', completed.error);
  }

  handlers.onStageChange('scanning');
  await waitForScan(completed.data.id);
  return {
    uploadId: completed.data.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  };
}

export function uploadChatAttachment(
  file: PreparedFile,
  handlers: { onProgress: (percent: number) => void; onStageChange: (stage: UploadStage) => void },
): Promise<PendingAttachment> {
  return uploadFile('chat_attachment', file, handlers);
}
