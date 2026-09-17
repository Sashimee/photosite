import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@photoo/shared';

export type LocalizedText = Partial<Record<Locale, string>>;

export interface ResolvedLocalizedText {
  text: string;
  locale: Locale;
}

// Fallback order: the route locale, then en (the contract's source of
// truth), then the first translated locale present, in SUPPORTED_LOCALES
// order so the result is deterministic.
export function resolveLocalizedText(
  value: LocalizedText | null | undefined,
  locale: Locale,
): ResolvedLocalizedText | null {
  if (!value) {
    return null;
  }

  const exact = value[locale];
  if (exact) {
    return { text: exact, locale };
  }

  const fallback = value[DEFAULT_LOCALE];
  if (fallback) {
    return { text: fallback, locale: DEFAULT_LOCALE };
  }

  for (const supported of SUPPORTED_LOCALES) {
    const text = value[supported];
    if (text) {
      return { text, locale: supported };
    }
  }

  return null;
}
