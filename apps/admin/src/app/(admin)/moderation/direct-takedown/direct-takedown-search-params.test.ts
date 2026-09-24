import { describe, expect, it } from 'vitest';

import { parseDirectTakedownSearchParams } from './direct-takedown-search-params';

describe('parseDirectTakedownSearchParams', () => {
  it('defaults to photographer_profile with no params', () => {
    expect(parseDirectTakedownSearchParams({})).toEqual({ targetType: 'photographer_profile' });
  });

  it('reads a known target type and slug', () => {
    expect(
      parseDirectTakedownSearchParams({ targetType: 'job_offer', slug: 'wedding-second-shooter' }),
    ).toEqual({ targetType: 'job_offer', slug: 'wedding-second-shooter' });
  });

  it('falls back to photographer_profile for a target type outside the direct-takedown enum', () => {
    expect(parseDirectTakedownSearchParams({ targetType: 'portfolio_image' })).toEqual({
      targetType: 'photographer_profile',
    });
  });

  it('trims whitespace and drops an empty slug', () => {
    expect(parseDirectTakedownSearchParams({ slug: '  ' })).toEqual({
      targetType: 'photographer_profile',
    });
    expect(parseDirectTakedownSearchParams({ slug: '  jane-doe  ' })).toEqual({
      targetType: 'photographer_profile',
      slug: 'jane-doe',
    });
  });

  it('takes the first value when a param repeats', () => {
    expect(
      parseDirectTakedownSearchParams({ targetType: ['job_offer', 'photographer_profile'] }),
    ).toEqual({ targetType: 'job_offer' });
  });
});
