import { describe, expect, it } from 'vitest';
import { CountrySummarySchema, PolicyVersionResponseSchema } from './countries.js';

describe('CountrySummarySchema', () => {
  const valid = {
    code: 'LU',
    name: 'Luxembourg',
    currency: 'EUR',
    defaultLocale: 'fr',
  };

  it('accepts a well-formed country summary', () => {
    expect(CountrySummarySchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a lowercase code', () => {
    expect(CountrySummarySchema.safeParse({ ...valid, code: 'lu' }).success).toBe(false);
  });

  it('rejects a lowercase currency', () => {
    expect(CountrySummarySchema.safeParse({ ...valid, currency: 'eur' }).success).toBe(false);
  });

  it('rejects an unsupported defaultLocale', () => {
    expect(CountrySummarySchema.safeParse({ ...valid, defaultLocale: 'it' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(CountrySummarySchema.safeParse({ ...valid, vatRate: 17 }).success).toBe(false);
  });
});

describe('PolicyVersionResponseSchema', () => {
  it('accepts a published version', () => {
    expect(PolicyVersionResponseSchema.safeParse({ policyVersion: '3' }).success).toBe(true);
  });

  it('accepts null, meaning nothing has been published yet', () => {
    expect(PolicyVersionResponseSchema.safeParse({ policyVersion: null }).success).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(PolicyVersionResponseSchema.safeParse({ policyVersion: '' }).success).toBe(false);
  });
});
