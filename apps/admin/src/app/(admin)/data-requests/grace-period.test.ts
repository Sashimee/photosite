import { describe, expect, it } from 'vitest';

import { graceDaysRemaining, isOverdueDeletion } from './grace-period';

describe('graceDaysRemaining', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');

  it('is thirty days for a deletion requested just now', () => {
    expect(graceDaysRemaining('2026-09-25T12:00:00.000Z', now)).toBe(30);
  });

  it('rounds a partial day left up rather than down', () => {
    expect(graceDaysRemaining('2026-08-27T00:00:00.000Z', now)).toBe(1);
  });

  it('counts whole days left', () => {
    expect(graceDaysRemaining('2026-09-01T12:00:00.000Z', now)).toBe(6);
  });

  it('clamps a deadline already passed to zero instead of a negative count', () => {
    expect(graceDaysRemaining('2026-01-01T12:00:00.000Z', now)).toBe(0);
  });

  it('is zero exactly at the deadline instant', () => {
    expect(graceDaysRemaining('2026-08-26T12:00:00.000Z', now)).toBe(0);
  });
});

describe('isOverdueDeletion', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');

  it('is not overdue exactly at the deadline instant', () => {
    expect(isOverdueDeletion('2026-08-26T12:00:00.000Z', null, now)).toBe(false);
  });

  it('is not overdue exactly at the deadline plus the slack', () => {
    expect(isOverdueDeletion('2026-08-25T12:00:00.000Z', null, now)).toBe(false);
  });

  it('is overdue just past the deadline plus the slack', () => {
    expect(isOverdueDeletion('2026-08-25T11:59:59.999Z', null, now)).toBe(true);
  });

  it('is overdue with a failureReason set even before the deadline', () => {
    expect(isOverdueDeletion('2026-09-20T12:00:00.000Z', 'anonymisation_failed', now)).toBe(true);
  });

  it('is not overdue with no failureReason and time left in the grace period', () => {
    expect(isOverdueDeletion('2026-09-20T12:00:00.000Z', null, now)).toBe(false);
  });
});
