import { describe, expect, it } from 'vitest';

import {
  dataRequestsFiltersKey,
  parseDataRequestsSearchParams,
} from './data-requests-search-params';

describe('parseDataRequestsSearchParams', () => {
  it('reads status, type and userId from the raw params', () => {
    expect(
      parseDataRequestsSearchParams({
        status: 'pending',
        type: 'delete',
        userId: '11111111-1111-1111-1111-111111111111',
      }),
    ).toEqual({
      status: 'pending',
      type: 'delete',
      userId: '11111111-1111-1111-1111-111111111111',
    });
  });

  it('trims whitespace and drops an empty userId', () => {
    expect(parseDataRequestsSearchParams({ userId: '  ' })).toEqual({});
    expect(parseDataRequestsSearchParams({ userId: '  abc  ' })).toEqual({ userId: 'abc' });
  });

  it('drops a status or type outside the known enum', () => {
    expect(parseDataRequestsSearchParams({ status: 'archived', type: 'wipe' })).toEqual({});
  });

  it('takes the first value when a param repeats', () => {
    expect(parseDataRequestsSearchParams({ status: ['pending', 'ready'] })).toEqual({
      status: 'pending',
    });
  });

  it('returns an empty object for no params', () => {
    expect(parseDataRequestsSearchParams({})).toEqual({});
  });
});

describe('dataRequestsFiltersKey', () => {
  it('produces a stable key that changes when a filter changes', () => {
    const base = dataRequestsFiltersKey({});
    expect(dataRequestsFiltersKey({ status: 'pending' })).not.toBe(base);
    expect(dataRequestsFiltersKey({ type: 'delete' })).not.toBe(base);
    expect(dataRequestsFiltersKey({ userId: 'abc' })).not.toBe(base);
    expect(dataRequestsFiltersKey({ status: 'pending' })).toBe(
      dataRequestsFiltersKey({ status: 'pending' }),
    );
  });
});
