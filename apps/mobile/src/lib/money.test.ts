import { describe, expect, it } from '@jest/globals';

import { formatMoney } from './money';

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
