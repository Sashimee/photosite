import { IdSchema } from '@photoo/shared';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';

const VerificationCaseCursorSchema = z
  .object({ submittedAt: z.iso.datetime({ offset: true }).nullable(), id: IdSchema })
  .strict();

export type VerificationCaseCursor = z.infer<typeof VerificationCaseCursorSchema>;

export function decodeVerificationCaseCursor(cursor: string): VerificationCaseCursor {
  return decodeCursor(cursor, VerificationCaseCursorSchema);
}

export function encodeVerificationCaseCursor(submittedAt: Date | null, id: string): string {
  return encodeCursor({ submittedAt: submittedAt ? submittedAt.toISOString() : null, id });
}
