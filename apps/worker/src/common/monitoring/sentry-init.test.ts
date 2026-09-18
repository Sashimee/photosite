import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_ENV } from '../../testing/test-env.js';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
}));

describe('initSentry', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not initialize the SDK when SENTRY_DSN is unset', async () => {
    const Sentry = await import('@sentry/node');
    const { initSentry } = await import('./sentry-init.js');

    initSentry(TEST_ENV);

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initializes the SDK with the redacting beforeSend when SENTRY_DSN is set', async () => {
    const Sentry = await import('@sentry/node');
    const { initSentry } = await import('./sentry-init.js');

    initSentry({
      ...TEST_ENV,
      SENTRY_DSN: 'https://public@o0.ingest.sentry.io/1',
      SENTRY_ENVIRONMENT: 'preview',
      SENTRY_TRACES_SAMPLE_RATE: 0.2,
    });

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@o0.ingest.sentry.io/1',
        environment: 'preview',
        tracesSampleRate: 0.2,
        sendDefaultPii: false,
        beforeSend: expect.any(Function) as unknown,
      }),
    );
  });

  it('falls back to NODE_ENV when SENTRY_ENVIRONMENT is unset', async () => {
    const Sentry = await import('@sentry/node');
    const { initSentry } = await import('./sentry-init.js');

    initSentry({ ...TEST_ENV, SENTRY_DSN: 'https://public@o0.ingest.sentry.io/1' });

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ environment: TEST_ENV.NODE_ENV }),
    );
  });
});
