import { IdSchema } from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from './cursor.js';

const CreatedAtCursorSchema = z
  .object({ createdAt: z.iso.datetime({ offset: true }), id: IdSchema })
  .strict();

export type CreatedAtCursor = z.infer<typeof CreatedAtCursorSchema>;

export function decodeCreatedAtCursor(cursor: string): CreatedAtCursor {
  return decodeCursor(cursor, CreatedAtCursorSchema);
}

export function encodeCreatedAtCursor(createdAt: Date, id: string): string {
  return encodeCursor({ createdAt: createdAt.toISOString(), id });
}
