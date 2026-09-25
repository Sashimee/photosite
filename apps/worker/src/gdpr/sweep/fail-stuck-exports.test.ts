import { describe, expect, it, vi } from 'vitest';
import { failStuckExports } from './fail-stuck-exports.js';

function fakeLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function fakeDeps(options: {
  findMany: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  userFindUnique?: ReturnType<typeof vi.fn>;
}) {
  const auditRecord = vi.fn(() => Promise.resolve());
  const emailQueueAdd = vi.fn(() => Promise.resolve());
  const userFindUnique =
    options.userFindUnique ??
    vi.fn(() => Promise.resolve({ email: 'user@example.test', deletedAt: null }));

  return {
    auditRecord,
    emailQueueAdd,
    userFindUnique,
    deps: {
      prisma: {
        client: {
          dataRequest: { findMany: options.findMany, updateMany: options.updateMany },
          user: { findUnique: userFindUnique },
        },
      } as never,
      auditLog: { record: auditRecord },
      logger: fakeLogger() as never,
      emailQueue: { add: emailQueueAdd },
      webAppUrl: 'https://example.test',
    },
  };
}

describe('failStuckExports', () => {
  it('fails exports stuck in processing past the threshold, records the count and emails each user', async () => {
    const findMany = vi.fn(() =>
      Promise.resolve([
        { id: 'data-request-1', userId: 'user-1' },
        { id: 'data-request-2', userId: 'user-2' },
      ]),
    );
    const updateMany = vi.fn(() => Promise.resolve({ count: 1 }));
    const { auditRecord, emailQueueAdd, deps } = fakeDeps({ findMany, updateMany });

    const result = await failStuckExports(deps);

    expect(result.exportsFailed).toBe(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { type: 'export', status: 'processing', updatedAt: { lte: expect.any(Date) as Date } },
      select: { id: true, userId: true },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'data-request-1', status: 'processing' },
      data: { status: 'failed', failureReason: 'stuck_processing' },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'data-request-2', status: 'processing' },
      data: { status: 'failed', failureReason: 'stuck_processing' },
    });
    expect(emailQueueAdd).toHaveBeenCalledTimes(2);
    expect(emailQueueAdd).toHaveBeenCalledWith(
      'data-export-failed',
      expect.objectContaining({ type: 'data-export-failed' }),
      expect.objectContaining({ jobId: 'data-export-failed-data-request-1' }),
    );
    expect(emailQueueAdd).toHaveBeenCalledWith(
      'data-export-failed',
      expect.objectContaining({ type: 'data-export-failed' }),
      expect.objectContaining({ jobId: 'data-export-failed-data-request-2' }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gdpr_sweep.exports_failed_stuck',
        after: { exportsFailed: 2 },
      }),
    );
  });

  it('does not email a row that was already transitioned before the sweep ran', async () => {
    const findMany = vi.fn(() => Promise.resolve([{ id: 'data-request-1', userId: 'user-1' }]));
    const updateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const { auditRecord, emailQueueAdd, deps } = fakeDeps({ findMany, updateMany });

    const result = await failStuckExports(deps);

    expect(result.exportsFailed).toBe(0);
    expect(emailQueueAdd).not.toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gdpr_sweep.exports_failed_stuck',
        after: { exportsFailed: 0 },
      }),
    );
  });

  it('does not email a user who has been deleted', async () => {
    const findMany = vi.fn(() => Promise.resolve([{ id: 'data-request-1', userId: 'user-1' }]));
    const updateMany = vi.fn(() => Promise.resolve({ count: 1 }));
    const userFindUnique = vi.fn(() =>
      Promise.resolve({ email: 'deleted@example.test', deletedAt: new Date() }),
    );
    const { emailQueueAdd, deps } = fakeDeps({ findMany, updateMany, userFindUnique });

    const result = await failStuckExports(deps);

    expect(result.exportsFailed).toBe(1);
    expect(emailQueueAdd).not.toHaveBeenCalled();
  });
});
