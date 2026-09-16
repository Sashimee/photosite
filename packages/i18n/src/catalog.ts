import {
  isArgumentElement,
  isDateElement,
  isNumberElement,
  isPluralElement,
  isSelectElement,
  isTagElement,
  isTimeElement,
  parse,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser';

export interface Catalog {
  [key: string]: string | Catalog;
}

export interface CatalogIssue {
  kind: 'extra-key' | 'argument-mismatch' | 'invalid-icu' | 'missing-key';
  locale: string;
  key: string;
  detail: string;
}

export interface CheckResult {
  errors: CatalogIssue[];
  warnings: CatalogIssue[];
}

export function flattenCatalog(catalog: Catalog, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      flat.set(path, value);
    } else {
      for (const [nestedKey, nestedValue] of flattenCatalog(value, path)) {
        flat.set(nestedKey, nestedValue);
      }
    }
  }
  return flat;
}

function collectArguments(elements: MessageFormatElement[], into: Set<string>): void {
  for (const element of elements) {
    if (isPluralElement(element)) {
      into.add(`${element.value}:plural`);
      for (const option of Object.values(element.options)) {
        collectArguments(option.value, into);
      }
    } else if (isSelectElement(element)) {
      into.add(`${element.value}:select`);
      for (const option of Object.values(element.options)) {
        collectArguments(option.value, into);
      }
    } else if (isTagElement(element)) {
      into.add(`${element.value}:tag`);
      collectArguments(element.children, into);
    } else if (isNumberElement(element)) {
      into.add(`${element.value}:number`);
    } else if (isDateElement(element)) {
      into.add(`${element.value}:date`);
    } else if (isTimeElement(element)) {
      into.add(`${element.value}:time`);
    } else if (isArgumentElement(element)) {
      into.add(`${element.value}:argument`);
    }
  }
}

export function extractArguments(message: string): Set<string> {
  const args = new Set<string>();
  collectArguments(parse(message), args);
  return args;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameArguments(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((arg) => b.has(arg));
}

export function checkCatalogs(
  source: Catalog,
  translations: Record<string, Catalog>,
  { strict }: { strict: boolean },
): CheckResult {
  const errors: CatalogIssue[] = [];
  const warnings: CatalogIssue[] = [];
  const sourceArguments = new Map<string, Set<string>>();

  for (const [key, message] of flattenCatalog(source)) {
    try {
      sourceArguments.set(key, extractArguments(message));
    } catch (error) {
      errors.push({ kind: 'invalid-icu', locale: 'en', key, detail: describeError(error) });
    }
  }
  const sourceKeys = new Set(flattenCatalog(source).keys());

  for (const [locale, catalog] of Object.entries(translations)) {
    const flat = flattenCatalog(catalog);

    for (const [key, message] of flat) {
      if (!sourceKeys.has(key)) {
        errors.push({ kind: 'extra-key', locale, key, detail: 'key does not exist in en' });
        continue;
      }
      let args: Set<string>;
      try {
        args = extractArguments(message);
      } catch (error) {
        errors.push({ kind: 'invalid-icu', locale, key, detail: describeError(error) });
        continue;
      }
      const expected = sourceArguments.get(key);
      if (expected && !sameArguments(expected, args)) {
        errors.push({
          kind: 'argument-mismatch',
          locale,
          key,
          detail: `expected [${[...expected].sort().join(', ')}], found [${[...args].sort().join(', ')}]`,
        });
      }
    }

    for (const key of sourceKeys) {
      if (!flat.has(key)) {
        const issue: CatalogIssue = {
          kind: 'missing-key',
          locale,
          key,
          detail: 'falls back to en',
        };
        (strict ? errors : warnings).push(issue);
      }
    }
  }

  return { errors, warnings };
}
