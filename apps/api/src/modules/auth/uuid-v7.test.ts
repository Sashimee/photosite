import { describe, expect, it } from 'vitest';
import { randomUuidV7 } from './uuid-v7.js';

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('randomUuidV7', () => {
  it('produces a well-formed version-7 uuid', () => {
    expect(randomUuidV7()).toMatch(UUID_V7_REGEX);
  });

  it('is unique across calls', () => {
    const values = new Set(Array.from({ length: 100 }, () => randomUuidV7()));
    expect(values.size).toBe(100);
  });
});
