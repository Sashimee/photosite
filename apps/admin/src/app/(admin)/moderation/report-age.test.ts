import { describe, expect, it } from 'vitest';

import { reportAgeDays } from './report-age';

describe('reportAgeDays', () => {
  const now = new Date('2026-09-24T12:00:00.000Z');

  it('is zero for a report filed just now', () => {
    expect(reportAgeDays('2026-09-24T12:00:00.000Z', now)).toBe(0);
  });

  it('floors partial days rather than rounding up', () => {
    expect(reportAgeDays('2026-09-23T13:00:00.000Z', now)).toBe(0);
    expect(reportAgeDays('2026-09-23T11:59:59.000Z', now)).toBe(1);
  });

  it('counts whole days elapsed', () => {
    expect(reportAgeDays('2026-09-20T12:00:00.000Z', now)).toBe(4);
  });

  it('clamps a createdAt in the future to zero instead of a negative age', () => {
    expect(reportAgeDays('2026-09-25T12:00:00.000Z', now)).toBe(0);
  });
});
