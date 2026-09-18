import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/node', () => ({
  isInitialized: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

function fakeJob(attemptsMade: number, attempts: number | undefined, id = 'job-1'): Job {
  return { id, attemptsMade, opts: { attempts } } as unknown as Job;
}

describe('reportJobFailure', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when Sentry is not initialized', async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.isInitialized).mockReturnValue(false);
    const { reportJobFailure } = await import('./report-job-failure.js');

    reportJobFailure('email', fakeJob(1, 1), new Error('smtp down'));

    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('records a breadcrumb but does not capture an event on an intermediate retry', async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const { reportJobFailure } = await import('./report-job-failure.js');

    reportJobFailure('email', fakeJob(1, 3), new Error('smtp down'));

    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning', message: 'email job failed' }),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('captures exactly one event on the final attempt, with queue, job id and attempt number but no job data', async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const { reportJobFailure } = await import('./report-job-failure.js');

    const error = new Error('smtp down');
    reportJobFailure('email', fakeJob(3, 3, 'job-42'), error);

    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', message: 'email job failed' }),
    );
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { queue: 'email' },
      extra: { jobId: 'job-42', attemptsMade: 3 },
    });
  });

  it('treats a job with no configured attempts option as a single, final attempt', async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const { reportJobFailure } = await import('./report-job-failure.js');

    reportJobFailure('file-scan', fakeJob(1, undefined), new Error('scan failed'));

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });

  it('records a breadcrumb only, never captures, when the job is undefined (stalled and removed)', async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    const { reportJobFailure } = await import('./report-job-failure.js');

    reportJobFailure('notify', undefined, new Error('stalled'));

    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning' }),
    );
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
