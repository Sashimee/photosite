import type { DataRequest } from '@photoo/db';
import { DataRequestSchema } from '@photoo/shared';
import type { z } from 'zod';

export function mapDataRequest(row: DataRequest): z.infer<typeof DataRequestSchema> {
  return DataRequestSchema.parse({
    id: row.id,
    type: row.type,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  });
}
