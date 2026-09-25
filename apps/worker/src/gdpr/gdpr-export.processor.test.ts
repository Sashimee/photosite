import type { Job } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { collectExportData, type CollectedExport } from './export/collect.js';
import { createGdprExportProcessor, type GdprExportDeps } from './gdpr-export.processor.js';

vi.mock('./export/collect.js', () => ({
  collectExportData: vi.fn(() => Promise.resolve(FAKE_COLLECTED_EXPORT)),
}));
vi.mock('./export/archive.js', () => ({
  writeZipArchive: vi.fn(() => Promise.resolve()),
}));
vi.mock('./export/policy-version.js', () => ({
  readPolicyVersion: vi.fn(() => Promise.resolve(null)),
}));

const FAKE_COLLECTED_EXPORT: CollectedExport = {
  user: {} as CollectedExport['user'],
  accounts: [],
  sessions: [],
  devices: [],
  consents: [],
  notifications: [],
  requests: [],
  quotes: [],
  photographerProfile: null,
  professionalProfile: null,
  jobOffers: [],
  jobApplications: [],
  products: [],
  portfolioImages: [],
  uploads: [],
  verificationCases: [],
  messages: [],
  files: [],
};

const DATA_REQUEST_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function fakeJob(attemptsMade = 1, attempts = 3): Job<{ dataRequestId: string }> {
  return {
    data: { dataRequestId: DATA_REQUEST_ID },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<{ dataRequestId: string }>;
}

function fakeLogger(): { logger: Logger; error: ReturnType<typeof vi.fn> } {
  const error = vi.fn();
  return { logger: { log: vi.fn(), warn: vi.fn(), error } as unknown as Logger, error };
}

interface FakeDataRequest {
  id: string;
  userId: string;
  type: string;
  status: string;
  expiresAt?: Date | null;
}

interface FakeUser {
  email: string;
  deletedAt: Date | null;
  status: string;
}

interface TestDeps {
  deps: GdprExportDeps;
  update: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  auditRecord: ReturnType<typeof vi.fn>;
  emailAdd: ReturnType<typeof vi.fn>;
  loggerError: ReturnType<typeof vi.fn>;
}

const ACTIVE_USER: FakeUser = { email: 'user@example.test', deletedAt: null, status: 'active' };

function fakeDeps(
  dataRequest: FakeDataRequest | null,
  userFails = false,
  user: FakeUser | null = ACTIVE_USER,
  options: { updateManyCount?: number; emailAddImpl?: () => Promise<void> } = {},
): TestDeps {
  const update = vi.fn(() => Promise.resolve(dataRequest));
  const updateMany = vi.fn(() => Promise.resolve({ count: options.updateManyCount ?? 1 }));
  const findUnique = vi.fn(() => Promise.resolve(dataRequest));
  const findUniqueUser = vi.fn(() => Promise.resolve(user));
  const auditRecord = vi.fn(() => Promise.resolve());
  const emailAdd = vi.fn(options.emailAddImpl ?? (() => Promise.resolve()));

  vi.mocked(collectExportData).mockImplementation(() =>
    userFails ? Promise.reject(new Error('boom')) : Promise.resolve(FAKE_COLLECTED_EXPORT),
  );

  const { logger, error: loggerError } = fakeLogger();

  const deps: GdprExportDeps = {
    prisma: {
      client: {
        dataRequest: { findUnique, update, updateMany },
        user: { findUnique: findUniqueUser },
      },
    } as never,
    storage: {
      config: { privateBucket: 'private' },
      getObjectStream: vi.fn(),
      putObjectStream: vi.fn(),
    },
    auditLog: { record: auditRecord },
    logger,
    emailQueue: { add: emailAdd },
    webAppUrl: 'https://example.test',
  };

  return { deps, update, updateMany, auditRecord, emailAdd, loggerError };
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

  it('skips the audit and email when the row already moved past processing before the failed update', async () => {
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
      { email: ACTIVE_USER.email, deletedAt: new Date(), status: 'active' },
    );
    const processor = createGdprExportProcessor(deps);

    await expect(processor(fakeJob(3, 3))).rejects.toThrow('boom');

    expect(emailAdd).not.toHaveBeenCalled();
  });

  it('fails a request for a non-active user without building an archive or sending an email', async () => {
    const { deps, updateMany, auditRecord, emailAdd } = fakeDeps(
      { id: DATA_REQUEST_ID, userId: 'user-1', type: 'export', status: 'pending' },
      false,
      { email: ACTIVE_USER.email, deletedAt: null, status: 'suspended' },
    );
    const processor = createGdprExportProcessor(deps);

    await processor(fakeJob());

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: DATA_REQUEST_ID, status: 'processing' },
      data: { status: 'failed', failureReason: 'user_inactive' },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'data_request.export_failed',
        after: { status: 'failed', failureReason: 'user_inactive' },
      }),
    );
    expect(collectExportData).not.toHaveBeenCalled();
    expect(emailAdd).not.toHaveBeenCalled();
  });

  it('skips the completed audit and ready email when the row already moved past processing', async () => {
    const { deps, updateMany, auditRecord, emailAdd } = fakeDeps(
      { id: DATA_REQUEST_ID, userId: 'user-1', type: 'export', status: 'pending' },
      false,
      ACTIVE_USER,
      { updateManyCount: 0 },
    );
    const processor = createGdprExportProcessor(deps);

    await processor(fakeJob());

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: DATA_REQUEST_ID, status: 'processing' },
      data: {
        status: 'ready',
        completedAt: expect.any(Date) as Date,
        exportKey: `gdpr-exports/${DATA_REQUEST_ID}.zip`,
        expiresAt: expect.any(Date) as Date,
      },
    });
    expect(auditRecord).not.toHaveBeenCalled();
    expect(emailAdd).not.toHaveBeenCalled();
  });

  it('builds the archive, marks the request ready, audits it and emails the ready link with the persisted expiry', async () => {
    const { deps, updateMany, auditRecord, emailAdd } = fakeDeps(
      { id: DATA_REQUEST_ID, userId: 'user-1', type: 'export', status: 'pending' },
      false,
      ACTIVE_USER,
    );
    const processor = createGdprExportProcessor(deps);

    await processor(fakeJob());

    const readyCall = (
      updateMany.mock.calls as [{ data: { status: string; expiresAt?: Date } }][]
    ).find(([arg]) => arg.data.status === 'ready');
    expect(readyCall).toBeDefined();
    const persistedExpiresAt = readyCall?.[0].data.expiresAt;
    expect(persistedExpiresAt).toBeInstanceOf(Date);

    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'data_request.export_completed',
        after: expect.objectContaining({ status: 'ready' }) as unknown,
      }),
    );

    expect(emailAdd).toHaveBeenCalledTimes(1);
    expect(emailAdd).toHaveBeenCalledWith(
      'data-export-ready',
      {
        type: 'data-export-ready',
        to: ACTIVE_USER.email,
        url: 'https://example.test/account',
        expiresAt: persistedExpiresAt?.toISOString(),
      },
      expect.objectContaining({ jobId: `data-export-ready-${DATA_REQUEST_ID}` }),
    );
  });

  it('re-sends the ready email with the stored expiry when a stale rerun finds the request already ready', async () => {
    const expiresAt = new Date('2026-10-01T00:00:00.000Z');
    const { deps, update, updateMany, emailAdd } = fakeDeps({
      id: DATA_REQUEST_ID,
      userId: 'user-1',
      type: 'export',
      status: 'ready',
      expiresAt,
    });
    const processor = createGdprExportProcessor(deps);

    await processor(fakeJob());

    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(emailAdd).toHaveBeenCalledTimes(1);
    expect(emailAdd).toHaveBeenCalledWith(
      'data-export-ready',
      {
        type: 'data-export-ready',
        to: ACTIVE_USER.email,
        url: 'https://example.test/account',
        expiresAt: expiresAt.toISOString(),
      },
      expect.objectContaining({ jobId: `data-export-ready-${DATA_REQUEST_ID}` }),
    );
  });

  it('still rethrows the original error when the failure follow-up itself throws', async () => {
    const { deps, auditRecord, loggerError } = fakeDeps(
      { id: DATA_REQUEST_ID, userId: 'user-1', type: 'export', status: 'pending' },
      true,
    );
    auditRecord.mockRejectedValueOnce(new Error('audit unavailable'));
    const processor = createGdprExportProcessor(deps);

    await expect(processor(fakeJob(3, 3))).rejects.toThrow('boom');

    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ dataRequestId: DATA_REQUEST_ID }),
      'gdpr-export: failed to record failure audit or notify user after export failure',
    );
  });
});
