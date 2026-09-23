import { IdSchema } from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';

const PublishedAtCursorSchema = z
  .object({ publishedAt: z.iso.datetime({ offset: true }), id: IdSchema })
  .strict();

export type PublishedAtCursor = z.infer<typeof PublishedAtCursorSchema>;

export function decodePublishedAtCursor(cursor: string): PublishedAtCursor {
  return decodeCursor(cursor, PublishedAtCursorSchema);
}

export function encodePublishedAtCursor(publishedAt: Date, id: string): string {
  return encodeCursor({ publishedAt: publishedAt.toISOString(), id });
}
