import { IdSchema } from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';

const AdminDataRequestCursorSchema = z
  .object({ requestedAt: z.iso.datetime({ offset: true }), id: IdSchema })
  .strict();

export type AdminDataRequestCursor = z.infer<typeof AdminDataRequestCursorSchema>;

export function decodeAdminDataRequestCursor(cursor: string): AdminDataRequestCursor {
  return decodeCursor(cursor, AdminDataRequestCursorSchema);
}

export function encodeAdminDataRequestCursor(requestedAt: Date, id: string): string {
  return encodeCursor({ requestedAt: requestedAt.toISOString(), id });
}
