import { describe, expect, it } from 'vitest';

import {
  centsToAmountInput,
  centsToMajorUnits,
  minorUnitDigits,
  parseAmountToCents,
} from './money';

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

describe('parseAmountToCents separators and extremes', () => {
  it.each([
    ['\t12.34\n', 'EUR', 1234],
    ['5.', 'EUR', 500],
    ['007.5', 'EUR', 750],
    ['0,5', 'EUR', 50],
    ['1,234', 'KWD', 1234],
    ['9007199254740991', 'JPY', 9007199254740991],
  ])('accepts %j %s as %i', (input, currency, expected) => {
    expect(parseAmountToCents(input, currency)).toEqual({ ok: true, amountCents: expected });
  });

  it.each([
    ['1,234', 'EUR'],
    ['1.234', 'EUR'],
    ['1,234', 'JPY'],
    ['12,345', 'EUR'],
  ])('never reads the thousands separator in %s %s as a decimal point', (input, currency) => {
    expect(parseAmountToCents(input, currency)).toEqual({ ok: false, reason: 'tooManyDecimals' });
  });

  it.each(['1,234.56', '1.234,56', '1,234,567', '1 234.56', "1'234.56", '+5', '+5.00', '.5', ',5'])(
    'rejects the mixed or prefixed format %j as invalid',
    (input) => {
      expect(parseAmountToCents(input, 'EUR')).toEqual({ ok: false, reason: 'invalid' });
    },
  );

  it.each([
    ['90071992547409.92', 'EUR'],
    ['9007199254740992', 'JPY'],
    ['1' + '0'.repeat(30), 'EUR'],
  ])('flags %s %s as too large', (input, currency) => {
    expect(parseAmountToCents(input, currency)).toEqual({ ok: false, reason: 'tooLarge' });
  });

  it('accepts the largest safe amount for EUR', () => {
    expect(parseAmountToCents('90071992547409.91', 'EUR')).toEqual({
      ok: true,
      amountCents: Number.MAX_SAFE_INTEGER,
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

describe('centsToAmountInput', () => {
  it('writes exact decimals that parse back to the same cents', () => {
    expect(centsToAmountInput(1234, 'EUR')).toBe('12.34');
    expect(centsToAmountInput(5, 'EUR')).toBe('0.05');
    expect(centsToAmountInput(1000, 'JPY')).toBe('1000');
    expect(centsToAmountInput(1, 'KWD')).toBe('0.001');
    expect(parseAmountToCents(centsToAmountInput(2500, 'EUR'), 'EUR')).toEqual({
      ok: true,
      amountCents: 2500,
    });
  });

  it.each([
    [0, 'EUR', '0.00'],
    [1, 'EUR', '0.01'],
    [10, 'EUR', '0.10'],
    [99, 'EUR', '0.99'],
    [100, 'EUR', '1.00'],
    [101, 'EUR', '1.01'],
    [Number.MAX_SAFE_INTEGER, 'EUR', '90071992547409.91'],
    [0, 'JPY', '0'],
    [1, 'JPY', '1'],
    [100, 'JPY', '100'],
    [0, 'KWD', '0.000'],
    [1, 'KWD', '0.001'],
    [1000, 'KWD', '1.000'],
  ])('writes %i minor units of %s as %s', (cents, currency, expected) => {
    expect(centsToAmountInput(cents, currency)).toBe(expected);
  });

  it.each([
    [0, 'EUR'],
    [1, 'EUR'],
    [100, 'EUR'],
    [999_999_999, 'EUR'],
    [1, 'KWD'],
    [12345, 'JPY'],
  ])('round-trips %i of %s through the amount parser', (cents, currency) => {
    const result = parseAmountToCents(centsToAmountInput(cents, currency), currency);
    expect(result).toEqual(
      cents === 0 ? { ok: false, reason: 'notPositive' } : { ok: true, amountCents: cents },
    );
  });
});
