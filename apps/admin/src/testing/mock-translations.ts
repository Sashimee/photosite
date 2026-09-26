import type {
  createFormatter as CreateFormatter,
  createTranslator as CreateTranslator,
} from 'next-intl';
import { vi } from 'vitest';

import { getMessages } from '@photoo/i18n';
import { DEFAULT_LOCALE } from '@photoo/shared';

import { ADMIN_FORMATS, ADMIN_TIME_ZONE } from '@/lib/datetime';

// Component tests that need both a mocked `useTranslations` and this real
// catalog lookup call `vi.mock('next-intl', ...)` with a factory that
// imports this file; a plain top-level `import ... from 'next-intl'` here
// would resolve to that same mock and recurse. `importActual` bypasses it.
const { createTranslator, createFormatter } = await vi.importActual<{
  createTranslator: typeof CreateTranslator;
  createFormatter: typeof CreateFormatter;
}>('next-intl');

// Namespace and key are only known at call time (built from two separate
// strings), unlike a real `useTranslations` call, so this can't use the
// literal key union `createTranslator` infers from `Messages`.
type LooseTranslator = (key: string, values?: Record<string, string | number | Date>) => string;

const translator = createTranslator({
  locale: DEFAULT_LOCALE,
  messages: getMessages(DEFAULT_LOCALE),
}) as LooseTranslator;

// A `useTranslations` stand-in for component tests: looks strings up from
// the real `en` catalog through next-intl's own ICU formatter (so plurals
// and other ICU features resolve exactly as they do in production), and
// falls back to the dotted key so a component test fails loudly if it
// renders a key that doesn't exist.
export function translate(
  namespace: string,
  key: string,
  values?: Record<string, unknown>,
): string {
  const fullKey = `${namespace}.${key}`;
  try {
    return translator(fullKey, values as Record<string, string | number | Date>);
  } catch {
    return fullKey;
  }
}

export function mockUseTranslations(namespace: string) {
  return (key: string, values?: Record<string, unknown>) => translate(namespace, key, values);
}

// A `useFormatter` stand-in for component tests: same locale, time zone and
// named formats as the real `NextIntlClientProvider` (apps/admin/src/app/layout.tsx),
// so a test asserting formatted dates sees exactly what renders in production.
export function mockUseFormatter() {
  return createFormatter({
    locale: DEFAULT_LOCALE,
    timeZone: ADMIN_TIME_ZONE,
    formats: ADMIN_FORMATS,
  });
}
