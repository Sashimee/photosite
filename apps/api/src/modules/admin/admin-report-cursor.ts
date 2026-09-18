import { IdSchema } from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';

const AdminReportCursorSchema = z
  .object({ createdAt: z.iso.datetime({ offset: true }), id: IdSchema })
  .strict();

export type AdminReportCursor = z.infer<typeof AdminReportCursorSchema>;

export function decodeAdminReportCursor(cursor: string): AdminReportCursor {
  return decodeCursor(cursor, AdminReportCursorSchema);
}

export function encodeAdminReportCursor(createdAt: Date, id: string): string {
  return encodeCursor({ createdAt: createdAt.toISOString(), id });
}
