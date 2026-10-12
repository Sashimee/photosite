import { describe, expect, it } from 'vitest';

import { parseProvenanceSearchParams, provenanceFiltersKey } from './provenance-search-params';

describe('parseProvenanceSearchParams', () => {
  it('defaults to pending_review with no verdict', () => {
    expect(parseProvenanceSearchParams({})).toEqual({ status: 'pending_review' });
  });

  it('accepts a known status and verdict', () => {
    expect(parseProvenanceSearchParams({ status: 'flagged', verdict: 'fail' })).toEqual({
      status: 'flagged',
      verdict: 'fail',
    });
  });

  it('falls back to the defaults for unknown values', () => {
    expect(parseProvenanceSearchParams({ status: 'bogus', verdict: 'maybe' })).toEqual({
      status: 'pending_review',
    });
  });

  it('uses the first value of a repeated param', () => {
    expect(parseProvenanceSearchParams({ verdict: ['review', 'pass'] })).toEqual({
      status: 'pending_review',
      verdict: 'review',
    });
  });
});

describe('provenanceFiltersKey', () => {
  it('differs when either filter differs', () => {
    expect(provenanceFiltersKey({ status: 'pending_review' })).not.toBe(
      provenanceFiltersKey({ status: 'pending_review', verdict: 'fail' }),
    );
  });
});
