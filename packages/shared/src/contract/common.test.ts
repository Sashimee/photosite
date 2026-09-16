import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  CountryCodeSchema,
  CurrencyCodeSchema,
  CursorPaginationQuerySchema,
  IdSchema,
  IsoDateTimeSchema,
  LocaleSchema,
  MoneySchema,
  errorResponses,
  paginatedResponseSchema,
} from './common.js';
import { z } from './zod.js';

describe('IdSchema', () => {
  it('accepts a UUID', () => {
    expect(IdSchema.safeParse('3fa85f64-5717-4562-b3fc-2c963f66afa6').success).toBe(true);
  });

  it('rejects a non-UUID string', () => {
    expect(IdSchema.safeParse('not-a-uuid').success).toBe(false);
  });
});

describe('IsoDateTimeSchema', () => {
  it('accepts an ISO 8601 date-time', () => {
    expect(IsoDateTimeSchema.safeParse('2026-09-16T12:00:00.000Z').success).toBe(true);
  });

  it('rejects a date-only string', () => {
    expect(IsoDateTimeSchema.safeParse('2026-09-16').success).toBe(false);
  });
});

describe('CurrencyCodeSchema', () => {
  it('accepts a 3-letter uppercase code', () => {
    expect(CurrencyCodeSchema.safeParse('EUR').success).toBe(true);
  });

  it('rejects a lowercase code', () => {
    expect(CurrencyCodeSchema.safeParse('eur').success).toBe(false);
  });

  it('rejects a code of the wrong length', () => {
    expect(CurrencyCodeSchema.safeParse('EU').success).toBe(false);
    expect(CurrencyCodeSchema.safeParse('EURO').success).toBe(false);
  });
});

describe('CountryCodeSchema', () => {
  it('accepts a 2-letter uppercase code', () => {
    expect(CountryCodeSchema.safeParse('LU').success).toBe(true);
  });

  it('rejects a lowercase or wrong-length code', () => {
    expect(CountryCodeSchema.safeParse('lu').success).toBe(false);
    expect(CountryCodeSchema.safeParse('LUX').success).toBe(false);
  });
});

describe('MoneySchema', () => {
  it('accepts non-negative integer cents with a currency', () => {
    expect(MoneySchema.safeParse({ amountCents: 1500, currency: 'EUR' }).success).toBe(true);
  });

  it('rejects negative or non-integer amounts', () => {
    expect(MoneySchema.safeParse({ amountCents: -1, currency: 'EUR' }).success).toBe(false);
    expect(MoneySchema.safeParse({ amountCents: 15.5, currency: 'EUR' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      MoneySchema.safeParse({ amountCents: 1500, currency: 'EUR', vatCents: 100 }).success,
    ).toBe(false);
  });
});

describe('LocaleSchema', () => {
  it('accepts a supported locale', () => {
    expect(LocaleSchema.safeParse('fr').success).toBe(true);
  });

  it('rejects an unsupported locale', () => {
    expect(LocaleSchema.safeParse('it').success).toBe(false);
  });
});

describe('CursorPaginationQuerySchema', () => {
  it('defaults limit to 20 when omitted', () => {
    const result = CursorPaginationQuerySchema.parse({});
    expect(result.limit).toBe(20);
  });

  it('accepts limit at the boundaries', () => {
    expect(CursorPaginationQuerySchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(CursorPaginationQuerySchema.safeParse({ limit: 100 }).success).toBe(true);
  });

  it('rejects limit outside 1..100', () => {
    expect(CursorPaginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(CursorPaginationQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(CursorPaginationQuerySchema.safeParse({ limit: 20, sort: 'asc' }).success).toBe(false);
  });
});

describe('paginatedResponseSchema', () => {
  it('wraps items and a nullable nextCursor', () => {
    const schema = paginatedResponseSchema(z.object({ id: z.string() }).strict());
    expect(schema.safeParse({ items: [{ id: '1' }], nextCursor: null }).success).toBe(true);
    expect(schema.safeParse({ items: [{ id: '1' }], nextCursor: 'abc' }).success).toBe(true);
  });

  it('rejects a missing nextCursor', () => {
    const schema = paginatedResponseSchema(z.object({ id: z.string() }).strict());
    expect(schema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe('ApiErrorSchema', () => {
  it('accepts a well-formed error', () => {
    expect(
      ApiErrorSchema.safeParse({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        requestId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown keys', () => {
    expect(
      ApiErrorSchema.safeParse({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        requestId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        stack: 'boom',
      }).success,
    ).toBe(false);
  });
});

describe('errorResponses', () => {
  it('builds a response entry per requested status code', () => {
    const responses = errorResponses([400, 404]);
    expect(Object.keys(responses)).toEqual(['400', '404']);
    expect(responses['400']?.description).toBe('Bad request');
    expect(responses['404']?.description).toBe('Not found');
  });
});
