import type { DataRequest } from '@photoo/db';
import type { Logger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionContext } from '../auth/session.js';
import type { AdminAccessService } from './admin-access.service.js';
import type { AdminAuditService } from './admin-audit.service.js';
import type { AdminDataRequestsRepository } from './admin-data-requests.repository.js';
import { AdminDataRequestsService } from './admin-data-requests.service.js';

vi.mock('../gdpr/apply-account-deletion.js', () => ({
  applyAccountDeletion: vi.fn(),
}));
vi.mock('../gdpr/blocking-obligations.js', () => ({
  assertNoBlockingObligations: vi.fn(),
}));

import { applyAccountDeletion } from '../gdpr/apply-account-deletion.js';
import type { DataRequestsService } from '../gdpr/data-requests.service.js';
import type { GdprExportQueueService } from '../gdpr/gdpr-export-queue.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';

const ACTOR_ID = '11111111-1111-1111-1111-111111111111';
const TARGET_ID = '22222222-2222-2222-2222-222222222222';

function fakeSession(): SessionContext {
  return {
    user: { id: ACTOR_ID },
    headers: new Headers(),
    session: {},
  } as unknown as SessionContext;
}

function fakeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-1',
    type: 'export',
    status: 'pending',
    channel: 'email',
    requestedAt: new Date(),
    receivedAt: new Date(),
    completedAt: null,
    expiresAt: null,
    failureReason: null,
    cancelledAt: null,
    user: {
      id: TARGET_ID,
      email: 'target@example.com',
      country: { timezone: 'Europe/Luxembourg' },
    },
    ...overrides,
  };
}

function buildService(protectedInTx: boolean, superadminWithFreshTwoFactor: boolean) {
  const createOfflineExport = vi.fn().mockResolvedValue(fakeRow());
  const hasAnyAdminPermissionGrantInTx = vi.fn().mockResolvedValue(false);
  const record = vi.fn().mockResolvedValue(undefined);
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const runPostDeletionSideEffects = vi.fn().mockResolvedValue(undefined);
  const isSuperadminWithFreshTwoFactor = vi.fn().mockResolvedValue(superadminWithFreshTwoFactor);

  const repository = {
    findUserForOffline: vi.fn().mockResolvedValue({
      id: TARGET_ID,
      email: 'target@example.com',
      status: 'active',
      roles: [],
    }),
    hasAnyAdminPermissionGrant: vi.fn().mockResolvedValue(false),
    findUserRolesInTx: vi.fn().mockResolvedValue({ roles: protectedInTx ? ['admin'] : [] }),
    hasAnyAdminPermissionGrantInTx,
    findOpenRequestForUser: vi.fn().mockResolvedValue(null),
    findUserStatusInTx: vi.fn().mockResolvedValue('active'),
    findUserStatus: vi.fn().mockResolvedValue('active'),
    createOfflineExport,
    findByIdInTx: vi.fn().mockResolvedValue(fakeRow({ type: 'delete' })),
  } as unknown as AdminDataRequestsRepository;

  const prisma = {
    client: { $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback({})) },
  } as unknown as PrismaService;

  const auditService = { record } as unknown as AdminAuditService;
  const exportQueue = { enqueue } as unknown as GdprExportQueueService;
  const dataRequestsService = { runPostDeletionSideEffects } as unknown as DataRequestsService;
  const adminAccess = { isSuperadminWithFreshTwoFactor } as unknown as AdminAccessService;
  const logger = { warn: vi.fn() } as unknown as Logger;

  const service = new AdminDataRequestsService(
    prisma,
    repository,
    auditService,
    exportQueue,
    dataRequestsService,
    adminAccess,
    logger,
  );

  return {
    service,
    createOfflineExport,
    hasAnyAdminPermissionGrantInTx,
    record,
    enqueue,
    runPostDeletionSideEffects,
  };
}

describe('AdminDataRequestsService.logOffline in-transaction re-check', () => {
  beforeEach(() => {
    vi.mocked(applyAccountDeletion).mockClear();
    vi.mocked(applyAccountDeletion).mockResolvedValue({ id: 'row-1' } as DataRequest);
  });

  it('rejects an export with 403 PROTECTED_TARGET when the target gains the admin role before the transaction runs, and creates no row', async () => {
    const { service, createOfflineExport, record } = buildService(true, false);

    const call = service.logOffline(
      fakeSession(),
      { userId: TARGET_ID, type: 'export', channel: 'email', receivedAt: new Date().toISOString() },
      undefined,
    );

    await expect(call).rejects.toMatchObject({
      status: 403,
      response: { code: 'PROTECTED_TARGET' },
    });
    expect(createOfflineExport).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('lets a superadmin with fresh 2FA log the export even though the target gained the admin role before the transaction ran', async () => {
    const { service, createOfflineExport, enqueue } = buildService(true, true);

    const result = await service.logOffline(
      fakeSession(),
      { userId: TARGET_ID, type: 'export', channel: 'email', receivedAt: new Date().toISOString() },
      undefined,
    );

    expect(createOfflineExport).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith('row-1');
    expect(result.id).toBe('row-1');
  });

  it('rejects a delete with 403 PROTECTED_TARGET when the target gains an admin permission grant before the transaction runs, and applies no deletion', async () => {
    const { service, hasAnyAdminPermissionGrantInTx, runPostDeletionSideEffects } = buildService(
      false,
      false,
    );
    hasAnyAdminPermissionGrantInTx.mockResolvedValue(true);

    const call = service.logOffline(
      fakeSession(),
      { userId: TARGET_ID, type: 'delete', channel: 'email', receivedAt: new Date().toISOString() },
      undefined,
    );

    await expect(call).rejects.toMatchObject({
      status: 403,
      response: { code: 'PROTECTED_TARGET' },
    });
    expect(applyAccountDeletion).not.toHaveBeenCalled();
    expect(runPostDeletionSideEffects).not.toHaveBeenCalled();
  });

  it('lets a superadmin with fresh 2FA log the delete even though the target gained an admin permission grant before the transaction ran', async () => {
    const { service, hasAnyAdminPermissionGrantInTx, runPostDeletionSideEffects } = buildService(
      false,
      true,
    );
    hasAnyAdminPermissionGrantInTx.mockResolvedValue(true);

    const result = await service.logOffline(
      fakeSession(),
      { userId: TARGET_ID, type: 'delete', channel: 'email', receivedAt: new Date().toISOString() },
      undefined,
    );

    expect(applyAccountDeletion).toHaveBeenCalledTimes(1);
    expect(runPostDeletionSideEffects).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('row-1');
  });
});
