import type { createTranslator as CreateTranslator } from 'next-intl';
import { vi } from 'vitest';

import { getMessages } from '@photoo/i18n';

// Component tests that need both a mocked `useTranslations` and this real
// catalog lookup call `vi.mock('next-intl', ...)` with a factory that
// imports this file; a plain top-level `import ... from 'next-intl'` here
// would resolve to that same mock and recurse. `importActual` bypasses it.
const { createTranslator } = await vi.importActual<{ createTranslator: typeof CreateTranslator }>(
  'next-intl',
);

// Namespace and key are only known at call time (built from two separate
// strings), unlike a real `useTranslations` call, so this can't use the
// literal key union `createTranslator` infers from `Messages`.
type LooseTranslator = (key: string, values?: Record<string, string | number | Date>) => string;

const translator = createTranslator({
  locale: 'en',
  messages: getMessages('en'),
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
