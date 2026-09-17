import { flattenCatalog, getMessages } from '@photoo/i18n';

const messages = flattenCatalog(getMessages('en'));

// A `useTranslations` stand-in for component tests: looks strings up from
// the real `en` catalog, so a component test fails if a key it renders goes
// missing, without requiring next-intl's React context.
export function translate(
  namespace: string,
  key: string,
  values?: Record<string, unknown>,
): string {
  const template = messages.get(`${namespace}.${key}`) ?? `${namespace}.${key}`;
  if (!values) {
    return template;
  }
  return Object.entries(values).reduce(
    (message, [name, value]) => message.replaceAll(`{${name}}`, String(value)),
    template,
  );
}

export function mockUseTranslations(namespace: string) {
  return (key: string, values?: Record<string, unknown>) => translate(namespace, key, values);
}
