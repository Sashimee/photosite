import * as Localization from 'expo-localization';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { initReactI18next } from 'react-i18next';

import { CATALOGS } from '@photoo/i18n';
import { DEFAULT_LOCALE, resolveLocale, type Locale } from '@photoo/shared';

const resources = Object.fromEntries(
  Object.entries(CATALOGS).map(([locale, catalog]) => [locale, { translation: catalog }]),
);

export function resolveDeviceLocale(locales: { languageTag: string }[]): Locale {
  return resolveLocale(locales.map((locale) => locale.languageTag));
}

export function getDeviceLocale(): Locale {
  return resolveDeviceLocale(Localization.getLocales());
}

void i18next
  .use(new ICU())
  .use(initReactI18next)
  .init({
    resources,
    lng: getDeviceLocale(),
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
  });

export default i18next;
