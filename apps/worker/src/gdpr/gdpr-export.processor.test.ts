import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { createGdprExportProcessor, type GdprExportDeps } from './gdpr-export.processor.js';

const DATA_REQUEST_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function fakeJob(attemptsMade = 1, attempts = 3): Job<{ dataRequestId: string }> {
  return {
    data: { dataRequestId: DATA_REQUEST_ID },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<{ dataRequestId: string }>;
}

function fakeLogger(): Logger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

interface FakeDataRequest {
  id: string;
  userId: string;
  type: string;
  status: string;
}

interface TestDeps {
  deps: GdprExportDeps;
  update: ReturnType<typeof vi.fn>;
  auditRecord: ReturnType<typeof vi.fn>;
}

function fakeDeps(dataRequest: FakeDataRequest | null, userFails = false): TestDeps {
  const update = vi.fn(() => Promise.resolve(dataRequest));
  const findUnique = vi.fn(() => Promise.resolve(dataRequest));
  const findUniqueOrThrow = vi.fn(() =>
    userFails ? Promise.reject(new Error('boom')) : Promise.resolve(null),
  );
  const auditRecord = vi.fn(() => Promise.resolve());

  const deps: GdprExportDeps = {
    prisma: {
      client: {
        dataRequest: { findUnique, update },
        user: { findUniqueOrThrow },
      },
    } as never,
    storage: {
      config: { privateBucket: 'private' },
      getObjectStream: vi.fn(),
      putObjectStream: vi.fn(),
    },
    auditLog: { record: auditRecord },
    logger: fakeLogger(),
  };

  return { deps, update, auditRecord };
}

describe('createGdprExportProcessor', () => {
  it('skips when the data request no longer exists', async () => {
    const { deps, update } = fakeDeps(null);
    const processor = createGdprExportProcessor(deps);

    await processor(fakeJob());

    expect(update).not.toHaveBeenCalled();
  });

  it('refuses to build an archive for a non-export request', async () => {
    const { deps, update } = fakeDeps({
      id: DATA_REQUEST_ID,
      userId: 'user-1',
      type: 'delete',
      status: 'pending',
    });
    const processor = createGdprExportProcessor(deps);

    await processor(fakeJob());

    expect(update).not.toHaveBeenCalled();
  });

  it('skips an already-ready or cancelled request instead of rebuilding', async () => {
    for (const status of ['ready', 'cancelled']) {
      const { deps, update } = fakeDeps({
        id: DATA_REQUEST_ID,
        userId: 'user-1',
        type: 'export',
        status,
      });
      const processor = createGdprExportProcessor(deps);

      await processor(fakeJob());

      expect(update).not.toHaveBeenCalled();
    }
  });

  it('marks the request failed with a stable reason on the final attempt', async () => {
    const { deps, update, auditRecord } = fakeDeps(
      { id: DATA_REQUEST_ID, userId: 'user-1', type: 'export', status: 'pending' },
      true,
    );
    const processor = createGdprExportProcessor(deps);

    await expect(processor(fakeJob(3, 3))).rejects.toThrow('boom');

    expect(update).toHaveBeenCalledWith({
      where: { id: DATA_REQUEST_ID },
      data: { status: 'processing' },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: DATA_REQUEST_ID },
      data: { status: 'failed', failureReason: 'export_failed' },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_request.export_failed' }),
    );
  });

  it('leaves status at processing and does not write an audit row before the final attempt', async () => {
    const { deps, update, auditRecord } = fakeDeps(
      { id: DATA_REQUEST_ID, userId: 'user-1', type: 'export', status: 'pending' },
      true,
    );
    const processor = createGdprExportProcessor(deps);

    await expect(processor(fakeJob(1, 3))).rejects.toThrow('boom');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: DATA_REQUEST_ID },
      data: { status: 'processing' },
    });
    expect(auditRecord).not.toHaveBeenCalled();
  });
});
