import { describe, expect, it } from 'vitest';
import { CitiesQuerySchema, CitySummarySchema } from './cities.js';

describe('CitySummarySchema', () => {
  const valid = {
    slug: 'luxembourg',
    name: 'Luxembourg',
    countryCode: 'LU',
    photographerCount: 3,
  };

  it('accepts a well-formed city summary', () => {
    expect(CitySummarySchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a lowercase countryCode', () => {
    expect(CitySummarySchema.safeParse({ ...valid, countryCode: 'lu' }).success).toBe(false);
  });

  it('rejects a zero photographerCount', () => {
    expect(CitySummarySchema.safeParse({ ...valid, photographerCount: 0 }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(CitySummarySchema.safeParse({ ...valid, region: 'Europe' }).success).toBe(false);
  });
});

describe('CitiesQuerySchema', () => {
  it('accepts an empty query with defaults', () => {
    const result = CitiesQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it('accepts countryCode and q', () => {
    expect(CitiesQuerySchema.safeParse({ countryCode: 'LU', q: 'lux' }).success).toBe(true);
  });

  it('rejects a q longer than 60 characters', () => {
    expect(CitiesQuerySchema.safeParse({ q: 'a'.repeat(61) }).success).toBe(false);
  });

  it('rejects a limit above 20', () => {
    expect(CitiesQuerySchema.safeParse({ limit: '21' }).success).toBe(false);
  });

  it('rejects a limit below 1', () => {
    expect(CitiesQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('rejects an invalid countryCode', () => {
    expect(CitiesQuerySchema.safeParse({ countryCode: 'lu' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(CitiesQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
  });
});
