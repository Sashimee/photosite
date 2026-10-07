import type { Locale } from '@photoo/shared';

export interface Money {
  amountCents: number;
  currency: string;
}

export function formatMoney(money: Money, locale: Locale): string;
export function formatMoney(money: Money | null | undefined, locale: Locale): string | null;
export function formatMoney(money: Money | null | undefined, locale: Locale): string | null {
  if (!money) {
    return null;
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(
    money.amountCents / 100,
  );
}

const WHOLE_UNITS = /^\d+$/;

// Anything but a plain non-negative whole number becomes NaN so the shared
// z.int() rejects it with a field error instead of sending a 0-cent budget.
export function wholeUnitsToCents(text: string): number {
  const trimmed = text.trim();
  return WHOLE_UNITS.test(trimmed) ? Number(trimmed) * 100 : Number.NaN;
}
