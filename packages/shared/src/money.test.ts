import { describe, expect, it } from 'vitest';
import { formatMinorUnits, minorUnitDigits } from './money.js';

describe('minorUnitDigits', () => {
  it('reads the ISO 4217 minor units', () => {
    expect(minorUnitDigits('EUR')).toBe(2);
    expect(minorUnitDigits('JPY')).toBe(0);
  });

  it('rejects a malformed currency code', () => {
    expect(() => minorUnitDigits('EURO')).toThrow(RangeError);
  });
});

describe('formatMinorUnits', () => {
  it('writes EUR cents as a decimal with two places', () => {
    expect(formatMinorUnits(1234, 'EUR')).toBe('12.34');
    expect(formatMinorUnits(25050, 'EUR')).toBe('250.50');
    expect(formatMinorUnits(100, 'EUR')).toBe('1.00');
  });

  it('pads amounts below one major unit', () => {
    expect(formatMinorUnits(0, 'EUR')).toBe('0.00');
    expect(formatMinorUnits(5, 'EUR')).toBe('0.05');
    expect(formatMinorUnits(99, 'EUR')).toBe('0.99');
  });

  it('keeps exact digits where a float division would drift', () => {
    expect(formatMinorUnits(30, 'EUR')).toBe('0.30');
    expect(formatMinorUnits(Number.MAX_SAFE_INTEGER, 'EUR')).toBe('90071992547409.91');
  });

  it('writes a negative amount with a leading minus', () => {
    expect(formatMinorUnits(-1234, 'EUR')).toBe('-12.34');
    expect(formatMinorUnits(-5, 'EUR')).toBe('-0.05');
  });

  it('writes a zero-decimal currency without a point', () => {
    expect(formatMinorUnits(1234, 'JPY')).toBe('1234');
  });

  it('rejects fractional and unsafe amounts', () => {
    expect(() => formatMinorUnits(12.5, 'EUR')).toThrow(RangeError);
    expect(() => formatMinorUnits(Number.MAX_SAFE_INTEGER + 1, 'EUR')).toThrow(RangeError);
    expect(() => formatMinorUnits(Number.NaN, 'EUR')).toThrow(RangeError);
  });
});
