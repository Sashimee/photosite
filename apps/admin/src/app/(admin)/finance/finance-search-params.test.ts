import { describe, expect, it } from 'vitest';

import { parseFinanceSearchParams, financeFiltersKey } from './finance-search-params';

describe('parseFinanceSearchParams', () => {
  it('returns no filters for empty params', () => {
    expect(parseFinanceSearchParams({})).toEqual({});
  });

  it('treats empty strings from an untouched form as absent', () => {
    expect(
      parseFinanceSearchParams({ status: '', createdFrom: '', createdTo: '', dispute: '' }),
    ).toEqual({});
    expect(parseFinanceSearchParams({ status: [''] })).toEqual({});
  });

  it('parses a single status', () => {
    expect(parseFinanceSearchParams({ status: 'released' })).toEqual({ status: ['released'] });
  });

  it('parses a repeated status, de-duplicated', () => {
    const filters = parseFinanceSearchParams({ status: ['released', 'disputed', 'released'] });
    expect([...(filters.status ?? [])].sort()).toEqual(['disputed', 'released']);
    expect(filters.status).toHaveLength(2);
  });

  it('drops an unknown status', () => {
    expect(parseFinanceSearchParams({ status: 'bogus' })).toEqual({});
    expect(parseFinanceSearchParams({ status: ['released', 'bogus'] })).toEqual({});
  });

  it.each(['any', 'open', 'none'] as const)('parses dispute=%s', (dispute) => {
    expect(parseFinanceSearchParams({ dispute })).toEqual({ dispute });
  });

  it('drops an unknown dispute value', () => {
    expect(parseFinanceSearchParams({ dispute: 'maybe' })).toEqual({});
  });

  it('parses a valid date range', () => {
    expect(
      parseFinanceSearchParams({ createdFrom: '2026-09-01', createdTo: '2026-10-01' }),
    ).toEqual({ createdFrom: '2026-09-01', createdTo: '2026-10-01' });
  });

  it('accepts a span of exactly 366 days', () => {
    expect(
      parseFinanceSearchParams({ createdFrom: '2025-01-01', createdTo: '2026-01-02' }),
    ).toEqual({ createdFrom: '2025-01-01', createdTo: '2026-01-02' });
  });

  it('drops both dates when the span is over 366 days', () => {
    expect(
      parseFinanceSearchParams({ createdFrom: '2025-01-01', createdTo: '2026-01-03' }),
    ).toEqual({});
  });

  it('drops both dates when to equals from', () => {
    expect(
      parseFinanceSearchParams({ createdFrom: '2026-09-01', createdTo: '2026-09-01' }),
    ).toEqual({});
  });

  it('drops both dates when to is before from', () => {
    expect(
      parseFinanceSearchParams({ createdFrom: '2026-09-10', createdTo: '2026-09-01' }),
    ).toEqual({});
  });

  it('drops a lone createdFrom or createdTo', () => {
    expect(parseFinanceSearchParams({ createdFrom: '2026-09-01' })).toEqual({});
    expect(parseFinanceSearchParams({ createdTo: '2026-09-01' })).toEqual({});
  });

  it('drops malformed and impossible dates', () => {
    expect(parseFinanceSearchParams({ createdFrom: 'yesterday', createdTo: '2026-09-01' })).toEqual(
      {},
    );
    expect(
      parseFinanceSearchParams({ createdFrom: '2026-02-30', createdTo: '2026-03-05' }),
    ).toEqual({});
  });

  it('keeps valid filters when another one is invalid', () => {
    expect(
      parseFinanceSearchParams({
        status: 'released',
        dispute: 'open',
        createdFrom: '2026-09-10',
        createdTo: '2026-09-01',
      }),
    ).toEqual({ status: ['released'], dispute: 'open' });
    expect(parseFinanceSearchParams({ status: 'released', dispute: 'maybe' })).toEqual({
      status: ['released'],
    });
  });

  it('ignores a cursor and unrelated params', () => {
    expect(parseFinanceSearchParams({ cursor: 'abc', foo: 'bar', status: 'released' })).toEqual({
      status: ['released'],
    });
  });

  it('drops an invalid status and an incomplete date pair without throwing', () => {
    expect(parseFinanceSearchParams({ status: 'bogus', createdFrom: '2026-01-01' })).toEqual({});
  });

  it('drops an invalid dispute and a reversed date range without throwing', () => {
    expect(
      parseFinanceSearchParams({
        dispute: 'x',
        createdFrom: '2026-02-01',
        createdTo: '2026-01-01',
      }),
    ).toEqual({});
  });
});

describe('financeFiltersKey', () => {
  it('differs when any filter differs and is stable for equal filters', () => {
    const keys = [
      financeFiltersKey({}),
      financeFiltersKey({ status: ['released'] }),
      financeFiltersKey({ dispute: 'open' }),
      financeFiltersKey({ createdFrom: '2026-09-01', createdTo: '2026-10-01' }),
    ];
    expect(new Set(keys).size).toBe(4);
    expect(financeFiltersKey({ dispute: 'open' })).toBe(financeFiltersKey({ dispute: 'open' }));
  });
});
