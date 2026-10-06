import { describe, expect, it } from 'vitest';

import { centsToMajorUnits, minorUnitDigits, parseAmountToCents } from './money';

describe('parseAmountToCents', () => {
  it.each([
    ['12.34', 'EUR', 1234],
    ['12,34', 'EUR', 1234],
    ['12', 'EUR', 1200],
    ['12.', 'EUR', 1200],
    ['0.1', 'EUR', 10],
    ['0.2', 'EUR', 20],
    ['0.30', 'EUR', 30],
    ['1.15', 'EUR', 115],
    ['19.99', 'EUR', 1999],
    ['  8.5  ', 'EUR', 850],
    ['1000', 'JPY', 1000],
    ['1.234', 'KWD', 1234],
  ])('converts %s %s to %i cents exactly', (input, currency, expected) => {
    expect(parseAmountToCents(input, currency)).toEqual({ ok: true, amountCents: expected });
  });

  it.each([
    ['12.345', 'EUR'],
    ['0.001', 'EUR'],
    ['10.5', 'JPY'],
  ])('rejects %s %s for having too many decimals', (input, currency) => {
    expect(parseAmountToCents(input, currency)).toEqual({ ok: false, reason: 'tooManyDecimals' });
  });

  it.each(['0', '0.00', '-5', '-0.01'])('rejects %s as not positive', (input) => {
    expect(parseAmountToCents(input, 'EUR')).toEqual({ ok: false, reason: 'notPositive' });
  });

  it.each(['', '  ', 'abc', '1e3', '1.2.3', '.5', '+5', '1 000', '12,34,5'])(
    'rejects %j as invalid',
    (input) => {
      expect(parseAmountToCents(input, 'EUR')).toEqual({ ok: false, reason: 'invalid' });
    },
  );

  it('rejects an amount beyond the safe integer range', () => {
    expect(parseAmountToCents('99999999999999999', 'EUR')).toEqual({
      ok: false,
      reason: 'tooLarge',
    });
  });
});

describe('minorUnitDigits', () => {
  it('follows the currency', () => {
    expect(minorUnitDigits('EUR')).toBe(2);
    expect(minorUnitDigits('JPY')).toBe(0);
    expect(minorUnitDigits('KWD')).toBe(3);
  });
});

describe('centsToMajorUnits', () => {
  it('scales by the currency minor unit', () => {
    expect(centsToMajorUnits(1234, 'EUR')).toBe(12.34);
    expect(centsToMajorUnits(1000, 'JPY')).toBe(1000);
  });
});
