import { HttpException } from '@nestjs/common';
import type { ZodType } from 'zod';

function invalidCursor(): HttpException {
  return new HttpException({ code: 'BAD_REQUEST', message: 'Invalid cursor' }, 400);
}

export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

// The cursor is opaque to clients: it is never interpreted before validating
// it decodes to JSON matching `schema`, and any failure (bad base64, bad
// JSON, wrong shape - including a cursor forged from another endpoint's
// payload) is a 400, never a 500 or a silently-ignored filter.
export function decodeCursor<T>(cursor: string, schema: ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw invalidCursor();
  }
  return result.data;
}
