import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

export type LocalizedText = Partial<Record<Locale, string>>;

// Fallback order: the device locale, then en (the contract's source of
// truth), then the first translated locale present, in SUPPORTED_LOCALES
// order so the result is deterministic.
export function resolveLocalizedText(
  value: LocalizedText | null | undefined,
  locale: Locale,
): string | null {
  if (!value) {
    return null;
  }
  const exact = value[locale] ?? value[DEFAULT_LOCALE];
  if (exact) {
    return exact;
  }
  for (const supported of SUPPORTED_LOCALES) {
    const text = value[supported];
    if (text) {
      return text;
    }
  }
  return null;
}
