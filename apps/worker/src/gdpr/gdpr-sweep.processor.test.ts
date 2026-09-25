import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGdprSweepProcessor } from './gdpr-sweep.processor.js';

vi.mock('@sentry/node', () => ({
  isInitialized: vi.fn(() => true),
  captureCheckIn: vi.fn(),
  captureException: vi.fn(),
}));

function fakeDeps(
  options: { failAnonymise?: boolean; failPurgeChat?: boolean; anonymiseUserFails?: boolean } = {},
) {
  const dataRequestFindMany = options.failAnonymise
    ? vi
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error('anonymise phase boom')))
        .mockImplementation(() => Promise.resolve([]))
    : options.anonymiseUserFails
      ? vi
          .fn()
          .mockImplementationOnce(() =>
            Promise.resolve([{ id: 'data-request-1', userId: 'user-1' }]),
          )
          .mockImplementation(() => Promise.resolve([]))
      : vi.fn(() => Promise.resolve([]));
  const dataRequestUpdateMany = vi.fn(() => Promise.resolve({ count: 0 }));
  const userFindMany = vi.fn(() => Promise.resolve([{ id: 'deleted-user-1' }]));
  const messageFindMany = options.failPurgeChat
    ? vi.fn(() => Promise.reject(new Error('purge-chat phase boom')))
    : vi.fn(() => Promise.resolve([]));
  const auditRecord = vi.fn(() => Promise.resolve());
  const logError = vi.fn();
  const logger = { log: vi.fn(), warn: vi.fn(), error: logError };
  const emailQueueAdd = vi.fn(() => Promise.resolve());

  return {
    dataRequestFindMany,
    dataRequestUpdateMany,
    userFindMany,
    messageFindMany,
    auditRecord,
    logError,
    logger,
    emailQueueAdd,
    deps: {
      prisma: {
        client: {
          dataRequest: { findMany: dataRequestFindMany, updateMany: dataRequestUpdateMany },
          user: { findMany: userFindMany },
          message: { findMany: messageFindMany },
        },
      } as never,
      storage: {
        config: { privateBucket: 'private', publicBucket: 'public' },
        deleteObject: vi.fn(() => Promise.resolve()),
      },
      auditLog: { record: auditRecord },
      logger: logger as never,
      monitorSlug: 'gdpr-sweep',
      monitorIntervalMs: 60 * 60 * 1000,
      emailQueue: { add: emailQueueAdd },
      webAppUrl: 'https://example.test',
    },
  };
}

describe('createGdprSweepProcessor', () => {
  beforeEach(async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.isInitialized).mockReturnValue(true);
    let checkInCounter = 0;
    vi.mocked(Sentry.captureCheckIn).mockImplementation(
      () => `check-in-${String(++checkInCounter)}`,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs every phase even when an earlier one throws, and reports it tagged with the phase only', async () => {
    const {
      dataRequestFindMany,
      dataRequestUpdateMany,
      userFindMany,
      messageFindMany,
      auditRecord,
      logError,
      deps,
    } = fakeDeps({ failAnonymise: true });

    const processor = createGdprSweepProcessor(deps);
    await processor(undefined as never);

    expect(dataRequestFindMany).toHaveBeenCalledTimes(3);
    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(messageFindMany).toHaveBeenCalledTimes(1);
    expect(dataRequestUpdateMany).toHaveBeenCalledTimes(0);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'anonymise-deletions' }),
      expect.any(String),
    );
    expect(auditRecord).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'gdpr_sweep.anonymised' }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'gdpr_sweep.chat_purged' }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'gdpr_sweep.exports_expired' }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'gdpr_sweep.exports_failed_stuck' }),
    );

    const Sentry = await import('@sentry/node');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { gdpr_phase: 'anonymise-deletions' },
      extra: {},
    });
  });

  it('sends an in_progress check-in with the schedule and margins first, then an ok check-in using its id', async () => {
    const { deps } = fakeDeps();

    const processor = createGdprSweepProcessor(deps);
    await processor(undefined as never);

    const Sentry = await import('@sentry/node');
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(
      1,
      { monitorSlug: 'gdpr-sweep', status: 'in_progress' },
      {
        schedule: { type: 'interval', value: 60, unit: 'minute' },
        checkinMargin: 15,
        maxRuntime: 60,
      },
    );
    const firstCheckInId = vi.mocked(Sentry.captureCheckIn).mock.results[0]?.value as string;
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      monitorSlug: 'gdpr-sweep',
      status: 'ok',
      checkInId: firstCheckInId,
    });
  });

  it('sends an error check-in, using the in_progress check-in id, when a phase throws', async () => {
    const { deps } = fakeDeps({ failAnonymise: true });

    const processor = createGdprSweepProcessor(deps);
    await processor(undefined as never);

    const Sentry = await import('@sentry/node');
    const firstCheckInId = vi.mocked(Sentry.captureCheckIn).mock.results[0]?.value as string;
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      monitorSlug: 'gdpr-sweep',
      status: 'error',
      checkInId: firstCheckInId,
    });
  });

  it('sends an error check-in when purge-chat throws', async () => {
    const { deps } = fakeDeps({ failPurgeChat: true });

    const processor = createGdprSweepProcessor(deps);
    await processor(undefined as never);

    const Sentry = await import('@sentry/node');
    const firstCheckInId = vi.mocked(Sentry.captureCheckIn).mock.results[0]?.value as string;
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      monitorSlug: 'gdpr-sweep',
      status: 'error',
      checkInId: firstCheckInId,
    });
  });

  it('sends an error check-in when anonymise-deletions reports usersFailed without throwing', async () => {
    const { dataRequestUpdateMany, auditRecord, deps } = fakeDeps({
      anonymiseUserFails: true,
    });

    const processor = createGdprSweepProcessor(deps);
    await processor(undefined as never);

    expect(dataRequestUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'data-request-1', status: 'pending' } }),
    );
    expect(auditRecord).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'gdpr_sweep.anonymised' }),
    );

    const Sentry = await import('@sentry/node');
    const firstCheckInId = vi.mocked(Sentry.captureCheckIn).mock.results[0]?.value as string;
    expect(Sentry.captureCheckIn).toHaveBeenNthCalledWith(2, {
      monitorSlug: 'gdpr-sweep',
      status: 'error',
      checkInId: firstCheckInId,
    });
  });

  it('does not check in when Sentry is not initialized', async () => {
    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.isInitialized).mockReturnValueOnce(false);
    const { deps } = fakeDeps();

    const processor = createGdprSweepProcessor(deps);
    await processor(undefined as never);

    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });
});
