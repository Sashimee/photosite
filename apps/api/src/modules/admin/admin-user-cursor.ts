import { IdSchema } from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';

const AdminUserCursorSchema = z
  .object({ createdAt: z.iso.datetime({ offset: true }), id: IdSchema })
  .strict();

export type AdminUserCursor = z.infer<typeof AdminUserCursorSchema>;

export function decodeAdminUserCursor(cursor: string): AdminUserCursor {
  return decodeCursor(cursor, AdminUserCursorSchema);
}

export function encodeAdminUserCursor(createdAt: Date, id: string): string {
  return encodeCursor({ createdAt: createdAt.toISOString(), id });
}
