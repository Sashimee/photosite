import { IdSchema } from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';

const DistanceCursorSchema = z
  .object({ mode: z.literal('distance'), value: z.number(), id: IdSchema })
  .strict();

const RatingCursorSchema = z
  .object({ mode: z.literal('rating'), value: z.number(), id: IdSchema })
  .strict();

export type SearchCursor =
  z.infer<typeof DistanceCursorSchema> | z.infer<typeof RatingCursorSchema>;

// The sort mode (distance vs. rating) is part of the cursor payload, so a
// cursor issued for one mode is simply invalid (400) if replayed against a
// search with the other mode, instead of silently reinterpreting its value.
export function decodeSearchCursor(cursor: string, isGeoSearch: boolean): SearchCursor {
  if (isGeoSearch) {
    return decodeCursor(cursor, DistanceCursorSchema);
  }
  return decodeCursor(cursor, RatingCursorSchema);
}

export function encodeSearchCursor(isGeoSearch: boolean, value: number, id: string): string {
  return encodeCursor({ mode: isGeoSearch ? 'distance' : 'rating', value, id });
}
