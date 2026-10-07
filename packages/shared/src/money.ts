export function minorUnitDigits(currency: string): number {
  const { maximumFractionDigits } = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
  }).resolvedOptions();
  if (maximumFractionDigits === undefined) {
    throw new RangeError(`minorUnitDigits: no minor-unit digits known for currency ${currency}`);
  }
  return maximumFractionDigits;
}

// Integer cents to a plain decimal in major units (`1234` EUR -> `12.34`),
// built from the digits rather than by dividing, so no float rounding can
// ever reach an exported or displayed amount.
export function formatMinorUnits(amountCents: number, currency: string): string {
  if (!Number.isSafeInteger(amountCents)) {
    throw new RangeError(
      `formatMinorUnits: amountCents must be a safe integer, got ${String(amountCents)}`,
    );
  }
  const digits = minorUnitDigits(currency);
  const sign = amountCents < 0 ? '-' : '';
  const absolute = String(Math.abs(amountCents));
  if (digits === 0) {
    return `${sign}${absolute}`;
  }
  const padded = absolute.padStart(digits + 1, '0');
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}
