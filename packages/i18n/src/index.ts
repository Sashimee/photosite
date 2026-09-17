import de from '../messages/de.json' with { type: 'json' };
import en from '../messages/en.json' with { type: 'json' };
import es from '../messages/es.json' with { type: 'json' };
import fr from '../messages/fr.json' with { type: 'json' };
import pt from '../messages/pt.json' with { type: 'json' };

import { DEFAULT_LOCALE, isLocale, type Locale } from '@photoo/shared';
import type { Catalog } from './catalog.js';

type DotPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : DotPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type Messages = typeof en;
export type MessageKey = DotPaths<Messages>;

export const CATALOGS: Record<Locale, Catalog> = { en, fr, de, pt, es };

export function mergeCatalogs(fallback: Catalog, override: Catalog): Catalog {
  const merged: Catalog = { ...fallback };
  for (const [key, value] of Object.entries(override)) {
    const base = merged[key];
    merged[key] =
      typeof value !== 'string' && base !== undefined && typeof base !== 'string'
        ? mergeCatalogs(base, value)
        : value;
  }
  return merged;
}

export function getMessages(locale: string): Messages {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return mergeCatalogs(CATALOGS[DEFAULT_LOCALE], CATALOGS[resolved]) as Messages;
}

export type { Catalog, CatalogIssue, CheckResult } from './catalog.js';
export { checkCatalogs, extractArguments, flattenCatalog } from './catalog.js';
export { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@photoo/shared';
