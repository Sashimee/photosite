import * as Sentry from '@sentry/react-native';

import { env } from './env';

export function initSentry(): void {
  if (!env.EXPO_PUBLIC_SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: env.EXPO_PUBLIC_SENTRY_DSN,
  });
}
