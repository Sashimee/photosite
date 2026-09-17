import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { decodeCreatedAtCursor, encodeCreatedAtCursor } from './created-at-cursor.js';

const VALID_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('encodeCreatedAtCursor / decodeCreatedAtCursor', () => {
  it('round-trips a createdAt/id payload', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const cursor = encodeCreatedAtCursor(createdAt, VALID_ID);
    expect(decodeCreatedAtCursor(cursor)).toEqual({
      createdAt: createdAt.toISOString(),
      id: VALID_ID,
    });
  });

  it('rejects a cursor that is not valid base64url JSON', () => {
    expect(() => decodeCreatedAtCursor('not-a-valid-cursor!!!')).toThrow(HttpException);
  });

  it('rejects a cursor missing the id field', () => {
    const cursor = Buffer.from(JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z' })).toString(
      'base64url',
    );
    expect(() => decodeCreatedAtCursor(cursor)).toThrow(HttpException);
  });

  it('rejects a cursor with a non-uuid id', () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', id: 'not-a-uuid' }),
    ).toString('base64url');
    expect(() => decodeCreatedAtCursor(cursor)).toThrow(HttpException);
  });

  it('rejects a cursor carrying unknown extra keys', () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', id: VALID_ID, extra: 'nope' }),
    ).toString('base64url');
    expect(() => decodeCreatedAtCursor(cursor)).toThrow(HttpException);
  });
});
