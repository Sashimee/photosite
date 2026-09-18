import { IdSchema } from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';

const AdminAuditLogCursorSchema = z
  .object({ occurredAt: z.iso.datetime({ offset: true }), id: IdSchema })
  .strict();

export type AdminAuditLogCursor = z.infer<typeof AdminAuditLogCursorSchema>;

export function decodeAdminAuditLogCursor(cursor: string): AdminAuditLogCursor {
  return decodeCursor(cursor, AdminAuditLogCursorSchema);
}

export function encodeAdminAuditLogCursor(occurredAt: Date, id: string): string {
  return encodeCursor({ occurredAt: occurredAt.toISOString(), id });
}
