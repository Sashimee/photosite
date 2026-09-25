import { createFormatter } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { ADMIN_FORMATS, ADMIN_TIME_ZONE } from './datetime';

function format(iso: string) {
  return createFormatter({
    locale: 'en',
    timeZone: ADMIN_TIME_ZONE,
    formats: ADMIN_FORMATS,
  }).dateTime(new Date(iso), 'medium');
}

describe('ADMIN_TIME_ZONE / ADMIN_FORMATS', () => {
  it('renders a winter UTC instant in Luxembourg standard time', () => {
    expect(format('2026-01-15T23:30:00Z')).toBe('Jan 16, 2026, 12:30 AM GMT+1');
  });

  it('renders a summer UTC instant in Luxembourg daylight time', () => {
    expect(format('2026-07-15T23:30:00Z')).toBe('Jul 16, 2026, 1:30 AM GMT+2');
  });

  it('renders the instant just before the spring-forward DST transition in CET', () => {
    expect(format('2026-03-29T00:59:00Z')).toBe('Mar 29, 2026, 1:59 AM GMT+1');
  });

  it('renders the instant of the spring-forward DST transition in CEST', () => {
    expect(format('2026-03-29T01:00:00Z')).toBe('Mar 29, 2026, 3:00 AM GMT+2');
  });

  it('renders the instant just before the fall-back DST transition in CEST', () => {
    expect(format('2026-10-25T00:59:00Z')).toBe('Oct 25, 2026, 2:59 AM GMT+2');
  });

  it('renders the instant of the fall-back DST transition in CET', () => {
    expect(format('2026-10-25T01:00:00Z')).toBe('Oct 25, 2026, 2:00 AM GMT+1');
  });

  it('renders a UTC instant just before midnight in the next local day', () => {
    expect(format('2026-01-01T23:59:00Z')).toBe('Jan 2, 2026, 12:59 AM GMT+1');
  });
});
