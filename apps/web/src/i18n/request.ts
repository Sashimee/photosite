import { getRequestConfig } from 'next-intl/server';
import { locale as rootLocale } from 'next/root-params';

import { getMessages } from '@photoo/i18n';
import { DEFAULT_LOCALE, isLocale } from '@photoo/shared';

export default getRequestConfig(async () => {
  const requested = await rootLocale();
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;

  return {
    locale,
    messages: getMessages(locale),
  };
});
