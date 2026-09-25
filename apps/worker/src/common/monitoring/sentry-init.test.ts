import type { Breadcrumb } from '@sentry/node';
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

  it('drops http breadcrumbs, which carry the full outgoing URL, but keeps others', async () => {
    const Sentry = await import('@sentry/node');
    const { initSentry } = await import('./sentry-init.js');

    initSentry({ ...TEST_ENV, SENTRY_DSN: 'https://public@o0.ingest.sentry.io/1' });

    const { beforeBreadcrumb } = vi.mocked(Sentry.init).mock.calls[0]?.[0] ?? {};
    if (!beforeBreadcrumb) {
      throw new Error('expected beforeBreadcrumb to be configured');
    }

    const httpBreadcrumb: Breadcrumb = {
      category: 'http',
      type: 'http',
      data: { url: 'https://storage.example.com/private/u/user-123/upload-1' },
    };
    const otherBreadcrumb: Breadcrumb = { category: 'console', message: 'hello' };

    expect(beforeBreadcrumb(httpBreadcrumb, {})).toBeNull();
    expect(beforeBreadcrumb(otherBreadcrumb, {})).toBe(otherBreadcrumb);
  });
});
