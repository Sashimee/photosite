import { describe, expect, it } from 'vitest';

import { hasPassed } from './date-status';

describe('hasPassed', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');

  it('is false for a date-time after now', () => {
    expect(hasPassed('2026-09-25T12:00:00.001Z', now)).toBe(false);
  });

  it('is true exactly at now, matching the API expiry boundary', () => {
    expect(hasPassed('2026-09-25T12:00:00.000Z', now)).toBe(true);
  });

  it('is true for a date-time before now', () => {
    expect(hasPassed('2026-09-25T11:59:59.999Z', now)).toBe(true);
  });
});
