import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({
  isInitialized: vi.fn(),
  captureException: vi.fn(),
}));

describe('reportException', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined and never calls captureException when Sentry is not initialized', async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.isInitialized).mockReturnValue(false);
    const { reportException } = await import('./sentry-report.js');

    const eventId = reportException(new Error('boom'));

    expect(eventId).toBeUndefined();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures the exception and returns the event id when Sentry is initialized', async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    vi.mocked(Sentry.captureException).mockReturnValue('event-123');
    const { reportException } = await import('./sentry-report.js');

    const error = new Error('boom');
    const eventId = reportException(error);

    expect(eventId).toBe('event-123');
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});
