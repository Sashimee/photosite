import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './relative-time';

const NOW = new Date('2026-06-15T12:00:00.000Z').getTime();

describe('formatRelativeTime', () => {
  it('renders "now" for sub-minute differences', () => {
    expect(formatRelativeTime('2026-06-15T11:59:40.000Z', 'en', NOW)).toBe('now');
  });

  it('renders minutes for sub-hour differences', () => {
    expect(formatRelativeTime('2026-06-15T11:45:00.000Z', 'en', NOW)).toBe('15 minutes ago');
  });

  it('renders hours for sub-day differences', () => {
    expect(formatRelativeTime('2026-06-15T09:00:00.000Z', 'en', NOW)).toBe('3 hours ago');
  });

  it('renders days for sub-week differences', () => {
    expect(formatRelativeTime('2026-06-13T12:00:00.000Z', 'en', NOW)).toBe('2 days ago');
  });

  it('renders weeks beyond that', () => {
    expect(formatRelativeTime('2026-06-01T12:00:00.000Z', 'en', NOW)).toBe('2 weeks ago');
  });

  it('renders future times', () => {
    expect(formatRelativeTime('2026-06-15T12:30:00.000Z', 'en', NOW)).toBe('in 30 minutes');
  });
});
