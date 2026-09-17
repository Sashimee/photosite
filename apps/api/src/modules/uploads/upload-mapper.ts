import type { Upload } from '@photoo/db';
import { UploadSchema } from '@photoo/shared';
import type { z } from 'zod';

export function mapUpload(upload: Upload): z.infer<typeof UploadSchema> {
  return UploadSchema.parse({
    id: upload.id,
    purpose: upload.purpose,
    status: upload.status,
    mimeType: upload.mimeType,
    declaredSizeBytes: upload.declaredSizeBytes,
    actualSizeBytes: upload.actualSizeBytes,
    virusScanStatus: upload.virusScanStatus,
    createdAt: upload.createdAt.toISOString(),
  });
}
