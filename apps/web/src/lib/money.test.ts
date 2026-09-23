import { describe, expect, it } from 'vitest';

import { formatMoney, lowestPrice, payoutAmount, requireMoney } from './money';

describe('formatMoney', () => {
  it('formats integer cents as currency in the given locale', () => {
    expect(formatMoney({ amountCents: 15000, currency: 'EUR' }, 'en')).toBe('€150.00');
  });

  it('uses the locale-specific grouping and decimal separators', () => {
    expect(formatMoney({ amountCents: 15000, currency: 'EUR' }, 'de')).toBe('150,00 €');
  });

  it('formats a different currency', () => {
    expect(formatMoney({ amountCents: 250000, currency: 'USD' }, 'en')).toBe('$2,500.00');
  });

  it('returns null for null or undefined money', () => {
    expect(formatMoney(null, 'en')).toBeNull();
    expect(formatMoney(undefined, 'en')).toBeNull();
  });
});

describe('lowestPrice', () => {
  it('returns the price with the lowest amountCents', () => {
    expect(
      lowestPrice([
        { amountCents: 40000, currency: 'EUR' },
        { amountCents: 15000, currency: 'EUR' },
        { amountCents: 90000, currency: 'EUR' },
      ]),
    ).toEqual({ amountCents: 15000, currency: 'EUR' });
  });

  it('skips null prices', () => {
    expect(lowestPrice([null, { amountCents: 20000, currency: 'EUR' }, null])).toEqual({
      amountCents: 20000,
      currency: 'EUR',
    });
  });

  it('returns null when every price is null or the list is empty', () => {
    expect(lowestPrice([null, null])).toBeNull();
    expect(lowestPrice([])).toBeNull();
  });
});

describe('requireMoney', () => {
  it('returns the money unchanged when present', () => {
    expect(requireMoney({ amountCents: 15000, currency: 'EUR' }, 'a product tier')).toEqual({
      amountCents: 15000,
      currency: 'EUR',
    });
  });

  it('throws with the given context when null or undefined', () => {
    expect(() => requireMoney(null, 'a product tier')).toThrow(/a product tier/);
    expect(() => requireMoney(undefined, 'a product tier')).toThrow(/a product tier/);
  });
});

describe('payoutAmount', () => {
  it('subtracts the platform fee from the subtotal', () => {
    expect(
      payoutAmount(
        { amountCents: 150000, currency: 'EUR' },
        { amountCents: 7500, currency: 'EUR' },
      ),
    ).toEqual({ amountCents: 142500, currency: 'EUR' });
  });

  it('throws on a currency mismatch instead of returning a wrong amount', () => {
    expect(() =>
      payoutAmount(
        { amountCents: 150000, currency: 'EUR' },
        { amountCents: 7500, currency: 'USD' },
      ),
    ).toThrow(/currency mismatch/);
  });
});
