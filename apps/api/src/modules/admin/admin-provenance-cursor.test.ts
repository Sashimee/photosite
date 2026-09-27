import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  decodeAdminProvenanceCursor,
  encodeAdminProvenanceCursor,
} from './admin-provenance-cursor.js';

function expectBadCursor(cursor: string): void {
  try {
    decodeAdminProvenanceCursor(cursor);
    expect.fail('expected decodeAdminProvenanceCursor to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(400);
  }
}

describe('admin provenance cursor', () => {
  it('round-trips createdAt and id through encode/decode', () => {
    const createdAt = new Date('2026-01-15T10:00:00.000Z');
    const id = '11111111-1111-4111-8111-111111111111';

    const cursor = encodeAdminProvenanceCursor(createdAt, id);
    const decoded = decodeAdminProvenanceCursor(cursor);

    expect(decoded).toEqual({ createdAt: createdAt.toISOString(), id });
  });

  it('rejects a cursor that is not valid base64url JSON', () => {
    expectBadCursor('not-a-cursor');
  });

  it('rejects a well-formed cursor missing the expected shape', () => {
    const cursor = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');
    expectBadCursor(cursor);
  });

  it('rejects a cursor with a non-uuid id', () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: '2026-01-15T10:00:00.000Z', id: 'not-a-uuid' }),
      'utf8',
    ).toString('base64url');
    expectBadCursor(cursor);
  });
});
