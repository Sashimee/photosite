export const SUPPORTED_LOCALES = ['en', 'fr', 'de', 'pt', 'es'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as Locale);
}

export function resolveLocale(input: string | string[] | undefined): Locale {
  if (!input) {
    return DEFAULT_LOCALE;
  }

  const tags = (Array.isArray(input) ? input : [input]).flatMap((entry) => entry.split(','));
  const parsed = tags
    .map((tag) => parseLanguageTag(tag))
    .filter((p): p is ParsedLanguageTag => p !== null)
    .sort((a, b) => (b.quality ?? 1) - (a.quality ?? 1));

  for (const tag of parsed) {
    const locale = SUPPORTED_LOCALES.find(
      (l) => l === tag.primary || l === tag.primary.substring(0, 2),
    );
    if (locale) {
      return locale;
    }
  }

  return DEFAULT_LOCALE;
}

interface ParsedLanguageTag {
  primary: string;
  quality: number | undefined;
}

function parseLanguageTag(tag: string): ParsedLanguageTag | null {
  tag = tag.trim();
  if (!tag) return null;

  const parts = tag.split(';');
  const primaryPart = parts[0]?.trim().split('-')[0]?.toLowerCase();

  if (!primaryPart) return null;

  let quality: number | undefined;
  const qPart = parts[1];
  if (qPart) {
    const qRegex = /q\s*=\s*([\d.]+)/i;
    const qMatch = qRegex.exec(qPart.trim());
    if (qMatch?.[1]) {
      quality = parseFloat(qMatch[1]);
    }
  }

  return { primary: primaryPart, quality };
}
