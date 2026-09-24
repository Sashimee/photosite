import { describe, expect, it } from 'vitest';

import { moderationFiltersKey, parseModerationSearchParams } from './moderation-search-params';

describe('parseModerationSearchParams', () => {
  it('defaults to open with no params', () => {
    expect(parseModerationSearchParams({})).toEqual({ status: 'open' });
  });

  it('reads a known status and target type', () => {
    expect(
      parseModerationSearchParams({ status: 'resolved', targetType: 'portfolio_image' }),
    ).toEqual({ status: 'resolved', targetType: 'portfolio_image' });
  });

  it('falls back to open for an unknown status', () => {
    expect(parseModerationSearchParams({ status: 'archived' })).toEqual({ status: 'open' });
  });

  it('drops an unknown target type', () => {
    expect(parseModerationSearchParams({ targetType: 'comment' })).toEqual({ status: 'open' });
  });

  it('takes the first value when a param repeats', () => {
    expect(parseModerationSearchParams({ status: ['resolved', 'dismissed'] })).toEqual({
      status: 'resolved',
    });
  });
});

describe('moderationFiltersKey', () => {
  it('produces a stable key that changes when a filter changes', () => {
    const base = moderationFiltersKey({ status: 'open' });
    expect(moderationFiltersKey({ status: 'resolved' })).not.toBe(base);
    expect(moderationFiltersKey({ status: 'open', targetType: 'request' })).not.toBe(base);
    expect(moderationFiltersKey({ status: 'open' })).toBe(base);
  });
});
