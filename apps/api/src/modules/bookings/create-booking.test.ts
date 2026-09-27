import { HttpException } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import { describe, expect, it } from 'vitest';
import {
  assertQuoteFeeMatches,
  assertSupportedCurrency,
  PlatformFeeMismatchError,
} from './create-booking.js';

function quote(subtotalCents: number, platformFeeCents: number, feePercent = '5.00') {
  return {
    id: 'quote-1',
    subtotalCents,
    platformFeeCents,
    feePercent: new Prisma.Decimal(feePercent),
  };
}

describe('assertSupportedCurrency', () => {
  it('accepts EUR', () => {
    expect(() => {
      assertSupportedCurrency('EUR');
    }).not.toThrow();
  });

  it('refuses any other currency with a 422', () => {
    try {
      assertSupportedCurrency('USD');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(422);
    }
  });

  it('is case sensitive, matching the upper-case ISO code stored on quotes', () => {
    expect(() => {
      assertSupportedCurrency('eur');
    }).toThrow(HttpException);
  });
});

describe('assertQuoteFeeMatches', () => {
  it('accepts a fee equal to the shared helper result, rounding half up', () => {
    expect(() => {
      assertQuoteFeeMatches(quote(25050, 1253));
    }).not.toThrow();
    expect(() => {
      assertQuoteFeeMatches(quote(1050, 53));
    }).not.toThrow();
  });

  it('accepts a zero fee on a zero subtotal', () => {
    expect(() => {
      assertQuoteFeeMatches(quote(0, 0));
    }).not.toThrow();
  });

  it('throws when the stored fee is one cent off', () => {
    expect(() => {
      assertQuoteFeeMatches(quote(25050, 1252));
    }).toThrow(PlatformFeeMismatchError);
    expect(() => {
      assertQuoteFeeMatches(quote(25050, 1254));
    }).toThrow(PlatformFeeMismatchError);
  });

  it('uses the fee percent stored on the quote, not the current default', () => {
    expect(() => {
      assertQuoteFeeMatches(quote(10000, 700, '7.00'));
    }).not.toThrow();
    expect(() => {
      assertQuoteFeeMatches(quote(10000, 500, '7.00'));
    }).toThrow(PlatformFeeMismatchError);
  });
});
