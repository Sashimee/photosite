import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from './cursor.js';

const PayloadSchema = z.object({ ratingCount: z.number(), id: z.string() }).strict();

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a payload', () => {
    const payload = { ratingCount: 12, id: 'abc' };
    const cursor = encodeCursor(payload);
    expect(decodeCursor(cursor, PayloadSchema)).toEqual(payload);
  });

  it('rejects a cursor that is not valid base64url JSON', () => {
    expect(() => decodeCursor('not-json-at-all-!!!', PayloadSchema)).toThrow(HttpException);
  });

  it('rejects a cursor decoding to the wrong shape', () => {
    const cursor = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url');
    expect(() => decodeCursor(cursor, PayloadSchema)).toThrow(HttpException);
  });

  it('rejects a cursor carrying unknown extra keys', () => {
    const cursor = encodeCursor({ ratingCount: 1, id: 'abc', extra: 'nope' });
    expect(() => decodeCursor(cursor, PayloadSchema)).toThrow(HttpException);
  });

  it('reports 400 on a malformed cursor', () => {
    try {
      decodeCursor('!!!', PayloadSchema);
      throw new Error('expected decodeCursor to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(400);
    }
  });
});
