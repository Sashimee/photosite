import * as Sentry from '@sentry/node';

export function reportException(exception: unknown): string | undefined {
  if (!Sentry.isInitialized()) {
    return undefined;
  }
  return Sentry.captureException(exception);
}
