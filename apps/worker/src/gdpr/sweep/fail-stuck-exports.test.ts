import { describe, expect, it, vi } from 'vitest';
import { failStuckExports } from './fail-stuck-exports.js';

function fakeLogger() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('failStuckExports', () => {
  it('fails exports stuck in processing past the threshold and records the count', async () => {
    const updateMany = vi.fn(() => Promise.resolve({ count: 2 }));
    const auditRecord = vi.fn(() => Promise.resolve());

    const result = await failStuckExports({
      prisma: { client: { dataRequest: { updateMany } } } as never,
      auditLog: { record: auditRecord },
      logger: fakeLogger() as never,
    });

    expect(result.exportsFailed).toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { type: 'export', status: 'processing', updatedAt: { lte: expect.any(Date) as Date } },
      data: { status: 'failed', failureReason: 'stuck_processing' },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gdpr_sweep.exports_failed_stuck',
        after: { exportsFailed: 2 },
      }),
    );
  });
});
