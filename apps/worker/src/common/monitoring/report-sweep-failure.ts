import * as Sentry from '@sentry/node';

export function reportSweepFailure(
  phase: string,
  error: unknown,
  extra: Record<string, unknown>,
): void {
  if (!Sentry.isInitialized()) {
    return;
  }

  Sentry.captureException(error, {
    tags: { gdpr_phase: phase },
    extra,
  });
}
