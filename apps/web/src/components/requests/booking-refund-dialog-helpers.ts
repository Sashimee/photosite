const AMOUNT_PATTERN = /^\d+(?:[.,]\d{1,2})?$/;

export function parseAmountToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }
  if (!AMOUNT_PATTERN.test(trimmed)) {
    return null;
  }
  const units = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(units) || units <= 0) {
    return null;
  }
  return Math.round(units * 100);
}
