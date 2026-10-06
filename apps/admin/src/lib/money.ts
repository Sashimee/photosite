import type { useFormatter } from 'next-intl';

export type AmountParseResult =
  | { ok: true; amountCents: number }
  | { ok: false; reason: 'invalid' | 'notPositive' | 'tooManyDecimals' | 'tooLarge' };

const AMOUNT_PATTERN = /^(-)?(\d+)(?:[.,](\d*))?$/;

export function minorUnitDigits(currency: string): number {
  const { maximumFractionDigits } = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions();
  if (maximumFractionDigits === undefined) {
    throw new Error(`No minor-unit digits known for currency ${currency}`);
  }
  return maximumFractionDigits;
}

// The generated Money type is nullable because its OpenAPI component is shared
// with fields that really can be null; a booking total never is.
export function requireMoney<T extends { amountCents: number; currency: string }>(
  money: T | null | undefined,
  context: string,
): T {
  if (!money) {
    throw new Error(`Expected ${context} to be present`);
  }
  return money;
}

export function parseAmountToCents(input: string, currency: string): AmountParseResult {
  const match = AMOUNT_PATTERN.exec(input.trim());
  if (!match) {
    return { ok: false, reason: 'invalid' };
  }
  const [, sign, whole = '', fraction = ''] = match;
  const digits = minorUnitDigits(currency);
  if (fraction.length > digits) {
    return { ok: false, reason: 'tooManyDecimals' };
  }
  const amountCents = Number(`${whole}${fraction.padEnd(digits, '0')}`);
  if (!Number.isSafeInteger(amountCents)) {
    return { ok: false, reason: 'tooLarge' };
  }
  if (sign || amountCents === 0) {
    return { ok: false, reason: 'notPositive' };
  }
  return { ok: true, amountCents };
}

// Display only: a major-unit number for Intl formatting, never sent to the API.
export function centsToMajorUnits(amountCents: number, currency: string): number {
  return amountCents / 10 ** minorUnitDigits(currency);
}

export function formatCents(
  format: Pick<ReturnType<typeof useFormatter>, 'number'>,
  amountCents: number,
  currency: string,
): string {
  return format.number(centsToMajorUnits(amountCents, currency), { style: 'currency', currency });
}
