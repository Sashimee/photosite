import { api } from './api';
import type { ApiErrorLike } from './request-errors';

export interface UploadedAttachment {
  uploadId: string;
}

export class ChatAttachmentError extends Error {
  readonly apiError: ApiErrorLike | undefined;

  constructor(message: string, apiError?: ApiErrorLike) {
    super(message);
    this.name = 'ChatAttachmentError';
    this.apiError = apiError;
  }
}

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
        reject(new ChatAttachmentError(`Upload failed with HTTP ${String(xhr.status)}`));
      }
    };
    xhr.onerror = () => {
      reject(new ChatAttachmentError('Upload failed'));
    };
    xhr.send(file);
  });
}

// Uploads one file through the existing presigned flow (1A.3): request the
// upload, PUT the bytes straight to storage, then confirm completion so the
// worker queues the virus scan. The resulting id is only attachable once the
// scan finishes; sending a message before then surfaces a 422 (mapped by the
// caller), rather than being pre-checked here.
export async function uploadChatAttachment(
  file: File,
  onProgress: (percent: number) => void,
): Promise<UploadedAttachment> {
  const created = await api.POST('/v1/uploads', {
    body: { purpose: 'chat_attachment', mimeType: file.type, sizeBytes: file.size },
  });
  if (!created.data) {
    throw new ChatAttachmentError('Could not start the upload', created.error);
  }

  await putWithProgress(created.data.url, file, created.data.headers, onProgress);

  const completed = await api.POST('/v1/uploads/{id}/complete', {
    params: { path: { id: created.data.uploadId } },
  });
  if (!completed.data) {
    throw new ChatAttachmentError('Could not confirm the upload', completed.error);
  }

  return { uploadId: completed.data.id };
}
