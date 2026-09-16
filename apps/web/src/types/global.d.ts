import type { Messages } from '@photoo/i18n';
import type { Locale } from '@photoo/shared';

declare module 'use-intl/core' {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
