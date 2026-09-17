import type { UploadStatus } from '@photoo/db';

const ATTACHABLE_UPLOAD_STATUSES = new Set<UploadStatus>(['clean', 'processed']);

export function isAttachableUploadStatus(status: UploadStatus): boolean {
  return ATTACHABLE_UPLOAD_STATUSES.has(status);
}
