import { describe, expect, it, vi } from 'vitest';
import { createGdprSweepProcessor } from './gdpr-sweep.processor.js';

describe('createGdprSweepProcessor', () => {
  it('runs every phase even when an earlier one throws', async () => {
    const dataRequestFindMany = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('anonymise phase boom')))
      .mockImplementation(() => Promise.resolve([]));
    const dataRequestUpdateMany = vi.fn(() => Promise.resolve({ count: 0 }));
    const userFindMany = vi.fn(() => Promise.resolve([{ id: 'deleted-user-1' }]));
    const messageFindMany = vi.fn(() => Promise.resolve([]));
    const auditRecord = vi.fn(() => Promise.resolve());
    const logError = vi.fn();
    const logger = { log: vi.fn(), warn: vi.fn(), error: logError };

    const processor = createGdprSweepProcessor({
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
    });

    await processor(undefined as never);

    expect(dataRequestFindMany).toHaveBeenCalledTimes(2);
    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(messageFindMany).toHaveBeenCalledTimes(1);
    expect(dataRequestUpdateMany).toHaveBeenCalledTimes(1);
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
  });
});
