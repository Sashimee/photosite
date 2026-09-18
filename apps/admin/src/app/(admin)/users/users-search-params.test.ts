import { describe, expect, it } from 'vitest';

import { parseUsersSearchParams, usersFiltersKey } from './users-search-params';

describe('parseUsersSearchParams', () => {
  it('reads q, role and status from the raw params', () => {
    expect(parseUsersSearchParams({ q: 'alice', role: 'photographer', status: 'active' })).toEqual({
      q: 'alice',
      role: 'photographer',
      status: 'active',
    });
  });

  it('trims whitespace and drops an empty search term', () => {
    expect(parseUsersSearchParams({ q: '  ' })).toEqual({});
    expect(parseUsersSearchParams({ q: '  alice  ' })).toEqual({ q: 'alice' });
  });

  it('drops a role or status outside the known enum', () => {
    expect(parseUsersSearchParams({ role: 'superadmin', status: 'banned' })).toEqual({});
  });

  it('takes the first value when a param repeats', () => {
    expect(parseUsersSearchParams({ q: ['first', 'second'] })).toEqual({ q: 'first' });
  });

  it('returns an empty object for no params', () => {
    expect(parseUsersSearchParams({})).toEqual({});
  });
});

describe('usersFiltersKey', () => {
  it('produces a stable key that changes when a filter changes', () => {
    const base = usersFiltersKey({});
    expect(usersFiltersKey({ q: 'alice' })).not.toBe(base);
    expect(usersFiltersKey({ role: 'admin' })).not.toBe(base);
    expect(usersFiltersKey({ status: 'suspended' })).not.toBe(base);
    expect(usersFiltersKey({ q: 'alice' })).toBe(usersFiltersKey({ q: 'alice' }));
  });
});
