import { IdSchema } from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';

const PortfolioCursorSchema = z.object({ order: z.number(), id: IdSchema }).strict();

export type PortfolioCursor = z.infer<typeof PortfolioCursorSchema>;

export function decodePortfolioCursor(cursor: string): PortfolioCursor {
  return decodeCursor(cursor, PortfolioCursorSchema);
}

export function encodePortfolioCursor(order: number, id: string): string {
  return encodeCursor({ order, id });
}
