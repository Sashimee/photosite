export type AmountParseResult =
  | { ok: true; amountCents: number }
  | { ok: false; reason: 'invalid' | 'notPositive' | 'tooManyDecimals' | 'tooLarge' };

const AMOUNT_PATTERN = /^(-)?(\d+)(?:[.,](\d*))?$/;

export function minorUnitDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits;
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
  format: { number: (value: number, options: Intl.NumberFormatOptions) => string },
  amountCents: number,
  currency: string,
): string {
  return format.number(centsToMajorUnits(amountCents, currency), { style: 'currency', currency });
}
