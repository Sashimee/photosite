import { getRequestConfig } from 'next-intl/server';

import { getMessages } from '@photoo/i18n';
import { DEFAULT_LOCALE } from '@photoo/shared';

import { ADMIN_FORMATS, ADMIN_TIME_ZONE } from '@/lib/datetime';

// Staff tooling, not a public storefront: one fixed locale, no [locale]
// route segment, so this ignores the request entirely instead of detecting
// one (docs/steps/1D.1-admin-shell.md).
export default getRequestConfig(() => ({
  locale: DEFAULT_LOCALE,
  messages: getMessages(DEFAULT_LOCALE),
  timeZone: ADMIN_TIME_ZONE,
  formats: ADMIN_FORMATS,
}));
