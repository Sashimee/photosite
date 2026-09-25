import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({
  isInitialized: vi.fn(),
  captureException: vi.fn(),
}));

describe('reportSweepFailure', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when Sentry is not initialized', async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.isInitialized).mockReturnValue(false);
    const { reportSweepFailure } = await import('./report-sweep-failure.js');

    reportSweepFailure('anonymise-deletions', new Error('boom'), { dataRequestId: 'req-1' });

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures the error tagged with the gdpr phase and the given extra only', async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const { reportSweepFailure } = await import('./report-sweep-failure.js');

    const error = new Error('boom');
    reportSweepFailure('anonymise-deletions', error, { dataRequestId: 'req-1' });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { gdpr_phase: 'anonymise-deletions' },
      extra: { dataRequestId: 'req-1' },
    });
  });
});
