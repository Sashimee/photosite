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

interface FakeUser {
  email: string;
  deletedAt: Date | null;
}

interface TestDeps {
  deps: GdprExportDeps;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  auditRecord: ReturnType<typeof vi.fn>;
  emailAdd: ReturnType<typeof vi.fn>;
}

const ACTIVE_USER: FakeUser = { email: 'user@example.test', deletedAt: null };

function fakeDeps(
  dataRequest: FakeDataRequest | null,
  userFails = false,
  user: FakeUser | null = ACTIVE_USER,
  options: { updateManyCount?: number; emailAddImpl?: () => Promise<void> } = {},
): TestDeps {
  const update = vi.fn(() => Promise.resolve(dataRequest));
  const updateMany = vi.fn(() => Promise.resolve({ count: options.updateManyCount ?? 1 }));
  const findUnique = vi.fn(() => Promise.resolve(dataRequest));
  const findUniqueOrThrow = vi.fn(() =>
    userFails ? Promise.reject(new Error('boom')) : Promise.resolve(null),
  );
  const findUniqueUser = vi.fn(() => Promise.resolve(user));
  const auditRecord = vi.fn(() => Promise.resolve());
  const emailAdd = vi.fn(options.emailAddImpl ?? (() => Promise.resolve()));

  const deps: GdprExportDeps = {
    prisma: {
      client: {
        dataRequest: { findUnique, update, updateMany },
        user: { findUniqueOrThrow, findUnique: findUniqueUser },
      },
    } as never,
    storage: {
      config: { privateBucket: 'private' },
      getObjectStream: vi.fn(),
      putObjectStream: vi.fn(),
    },
    auditLog: { record: auditRecord },
    logger: fakeLogger(),
    emailQueue: { add: emailAdd },
    webAppUrl: 'https://example.test',
  };

  return { deps, update, updateMany, auditRecord, emailAdd };
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
      const { deps, update, emailAdd } = fakeDeps({
        id: DATA_REQUEST_ID,
        userId: 'user-1',
        type: 'export',
        status,
      });
      const processor = createGdprExportProcessor(deps);

      await processor(fakeJob());

      expect(update).not.toHaveBeenCalled();
      expect(emailAdd).not.toHaveBeenCalled();
    }
  });

  it('marks the request failed with a stable reason on the final attempt', async () => {
    const { deps, update, updateMany, auditRecord, emailAdd } = fakeDeps(
      { id: DATA_REQUEST_ID, userId: 'user-1', type: 'export', status: 'pending' },
      true,
    );
    const processor = createGdprExportProcessor(deps);

    await expect(processor(fakeJob(3, 3))).rejects.toThrow('boom');

    expect(update).toHaveBeenCalledWith({
      where: { id: DATA_REQUEST_ID },
      data: { status: 'processing' },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: DATA_REQUEST_ID, status: 'processing' },
      data: { status: 'failed', failureReason: 'export_failed' },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'data_request.export_failed' }),
    );
    expect(emailAdd).toHaveBeenCalledTimes(1);
    expect(emailAdd).toHaveBeenCalledWith(
      'data-export-failed',
      {
        type: 'data-export-failed',
        to: ACTIVE_USER.email,
        url: 'https://example.test/account',
      },
      expect.objectContaining({ jobId: `data-export-failed-${DATA_REQUEST_ID}` }),
    );
  });

  it('leaves the row ready and sends no failed email when the row already moved past processing', async () => {
    const { deps, updateMany, auditRecord, emailAdd } = fakeDeps(
      { id: DATA_REQUEST_ID, userId: 'user-1', type: 'export', status: 'pending' },
      true,
      ACTIVE_USER,
      { updateManyCount: 0 },
    );
    const processor = createGdprExportProcessor(deps);

    await expect(processor(fakeJob(3, 3))).rejects.toThrow('boom');

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: DATA_REQUEST_ID, status: 'processing' },
      data: { status: 'failed', failureReason: 'export_failed' },
    });
    expect(auditRecord).not.toHaveBeenCalled();
    expect(emailAdd).not.toHaveBeenCalled();
  });

  it('leaves status at processing and does not write an audit row before the final attempt', async () => {
    const { deps, update, auditRecord, emailAdd } = fakeDeps(
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
    expect(emailAdd).not.toHaveBeenCalled();
  });

  it('sends no email when the export user is soft-deleted or anonymised', async () => {
    const { deps, emailAdd } = fakeDeps(
      { id: DATA_REQUEST_ID, userId: 'user-1', type: 'export', status: 'pending' },
      true,
      { email: ACTIVE_USER.email, deletedAt: new Date() },
    );
    const processor = createGdprExportProcessor(deps);

    await expect(processor(fakeJob(3, 3))).rejects.toThrow('boom');

    expect(emailAdd).not.toHaveBeenCalled();
  });
});
