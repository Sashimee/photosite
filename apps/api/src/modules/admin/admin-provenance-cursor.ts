import { IdSchema } from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';

const AdminProvenanceCursorSchema = z
  .object({ createdAt: z.iso.datetime({ offset: true }), id: IdSchema })
  .strict();

export type AdminProvenanceCursor = z.infer<typeof AdminProvenanceCursorSchema>;

export function decodeAdminProvenanceCursor(cursor: string): AdminProvenanceCursor {
  return decodeCursor(cursor, AdminProvenanceCursorSchema);
}

export function encodeAdminProvenanceCursor(createdAt: Date, id: string): string {
  return encodeCursor({ createdAt: createdAt.toISOString(), id });
}
