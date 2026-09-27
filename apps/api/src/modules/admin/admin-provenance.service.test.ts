import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminAuditService } from './admin-audit.service.js';
import { AdminProvenanceService } from './admin-provenance.service.js';
import type { AdminProvenanceRepository } from './admin-provenance.repository.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { ProvenanceCheckQueueService } from '../profiles/provenance-check-queue.service.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CHECK_ID = '22222222-2222-4222-8222-222222222222';
const PORTFOLIO_IMAGE_ID = '33333333-3333-4333-8333-333333333333';
const PROFILE_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555556';

function fakeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CHECK_ID,
    portfolioImageId: PORTFOLIO_IMAGE_ID,
    aiScore: '0.9',
    aiVendor: 'vendor-x',
    reverseMatches: [],
    c2paValid: null,
    exifCamera: null,
    exifCapturedAt: null,
    score: '0.9',
    verdict: 'pass',
    reviewedByAdminId: null,
    reviewedAt: null,
    note: null,
    decisionReason: null,
    decisionReasonText: null,
    raw: null,
    createdAt: new Date('2026-01-15T10:00:00.000Z'),
    updatedAt: new Date('2026-01-15T10:00:00.000Z'),
    portfolioImage: {
      id: PORTFOLIO_IMAGE_ID,
      status: 'processing',
      profile: { id: PROFILE_ID, userId: USER_ID, displayName: 'Jane Doe', slug: 'jane-doe' },
      upload: { variants: { medium_jpeg: 'uploads/medium.jpg' } },
    },
    ...overrides,
  };
}

function buildService() {
  const list = vi.fn();
  const findById = vi.fn();
  const record = vi.fn().mockResolvedValue(undefined);
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const findUniqueOrThrow = vi.fn();
  const notify = vi.fn().mockResolvedValue(undefined);
  const updateProvenanceCheck = vi.fn();
  const updatePortfolioImage = vi.fn();

  const repository = { list, findById } as unknown as AdminProvenanceRepository;
  const auditService = { record } as unknown as AdminAuditService;
  const provenanceQueue = { enqueue } as unknown as ProvenanceCheckQueueService;
  const notifications = { notify } as unknown as NotificationsService;
  const prisma = {
    client: {
      $transaction: vi.fn((callback: (tx: unknown) => unknown) =>
        callback({
          provenanceCheck: { update: updateProvenanceCheck, findUniqueOrThrow },
          portfolioImage: { update: updatePortfolioImage },
        }),
      ),
    },
  } as unknown as PrismaService;

  const service = new AdminProvenanceService(
    prisma,
    repository,
    auditService,
    provenanceQueue,
    notifications,
    { S3_PUBLIC_BASE_URL: 'https://cdn.example.com' } as never,
  );

  return {
    service,
    list,
    findById,
    record,
    enqueue,
    findUniqueOrThrow,
    notify,
    updateProvenanceCheck,
    updatePortfolioImage,
    prisma,
  };
}

describe('AdminProvenanceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('maps rows and omits nextCursor when there is no further page', async () => {
      const { service, list } = buildService();
      list.mockResolvedValue([fakeRow()]);

      const result = await service.list({ limit: 20 });

      expect(list).toHaveBeenCalledWith({ limit: 20 });
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    });

    it('returns a nextCursor built from the last row of the page when more rows exist', async () => {
      const { service, list } = buildService();
      list.mockResolvedValue([
        fakeRow({ id: '55555555-5555-4555-8555-555555555555' }),
        fakeRow({ id: '66666666-6666-4666-8666-666666666666' }),
      ]);

      const result = await service.list({ limit: 1 });

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).not.toBeNull();
    });

    it('decodes and forwards a cursor query param', async () => {
      const { service, list } = buildService();
      list.mockResolvedValue([]);
      const cursor = Buffer.from(
        JSON.stringify({ createdAt: '2026-01-15T10:00:00.000Z', id: CHECK_ID }),
        'utf8',
      ).toString('base64url');

      await service.list({ limit: 20, cursor });

      expect(list).toHaveBeenCalledWith({
        cursor: { createdAt: '2026-01-15T10:00:00.000Z', id: CHECK_ID },
        limit: 20,
      });
    });

    it('rejects a malformed cursor with 400', async () => {
      const { service } = buildService();

      await expect(service.list({ limit: 20, cursor: 'not-valid' })).rejects.toMatchObject({
        status: 400,
        response: { code: 'BAD_REQUEST' },
      });
    });
  });

  describe('getById', () => {
    it('returns the mapped detail when found', async () => {
      const { service, findById } = buildService();
      findById.mockResolvedValue(fakeRow());

      const result = await service.getById(CHECK_ID);

      expect(result.id).toBe(CHECK_ID);
    });

    it('throws 404 when not found', async () => {
      const { service, findById } = buildService();
      findById.mockResolvedValue(null);

      await expect(service.getById(CHECK_ID)).rejects.toMatchObject({
        status: 404,
        response: { code: 'NOT_FOUND' },
      });
    });
  });

  describe('decide', () => {
    it('throws 404 when the check does not exist', async () => {
      const { service, findById } = buildService();
      findById.mockResolvedValue(null);

      await expect(
        service.decide(
          { id: ADMIN_ID },
          CHECK_ID,
          { status: 'approved', note: 'looks fine' },
          '1.2.3.4',
        ),
      ).rejects.toMatchObject({ status: 404, response: { code: 'NOT_FOUND' } });
    });

    it('updates the check and image, writes an audit row, and returns the re-fetched detail', async () => {
      const { service, findById, record, findUniqueOrThrow } = buildService();
      findById.mockResolvedValue(fakeRow());
      findUniqueOrThrow.mockResolvedValue(
        fakeRow({ reviewedByAdminId: ADMIN_ID, note: 'looks fine' }),
      );

      const result = await service.decide(
        { id: ADMIN_ID },
        CHECK_ID,
        { status: 'approved', note: 'looks fine' },
        '1.2.3.4',
      );

      expect(record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorId: ADMIN_ID,
          action: 'provenance.decision',
          targetType: 'ProvenanceCheck',
          targetId: CHECK_ID,
          ip: '1.2.3.4',
        }),
      );
      expect(result.reviewedByAdminId).toBe(ADMIN_ID);
    });

    it('clears decisionReason and decisionReasonText on approve, and does not notify', async () => {
      const { service, findById, findUniqueOrThrow, updateProvenanceCheck, notify } =
        buildService();
      findById.mockResolvedValue(fakeRow());
      findUniqueOrThrow.mockResolvedValue(fakeRow());

      await service.decide(
        { id: ADMIN_ID },
        CHECK_ID,
        { status: 'approved', note: 'looks fine' },
        '1.2.3.4',
      );

      const [updateArgs] = updateProvenanceCheck.mock.calls[0] as [
        { data: { decisionReason: string | null; decisionReasonText: string | null } },
      ];
      expect(updateArgs.data).toMatchObject({ decisionReason: null, decisionReasonText: null });
      expect(notify).not.toHaveBeenCalled();
    });

    it('persists decisionReason/decisionReasonText and notifies the image owner on reject', async () => {
      const { service, findById, findUniqueOrThrow, updateProvenanceCheck, record, notify } =
        buildService();
      findById.mockResolvedValue(fakeRow());
      findUniqueOrThrow.mockResolvedValue(fakeRow());

      await service.decide(
        { id: ADMIN_ID },
        CHECK_ID,
        {
          status: 'rejected',
          note: 'admin-internal detail',
          decisionReason: 'ai_generated',
        },
        '1.2.3.4',
      );

      const [updateArgs] = updateProvenanceCheck.mock.calls[0] as [
        { data: { decisionReason: string | null; decisionReasonText: string | null } },
      ];
      expect(updateArgs.data).toMatchObject({
        decisionReason: 'ai_generated',
        decisionReasonText: null,
      });
      const [, recordArgs] = record.mock.calls[0] as [
        unknown,
        { after: { decisionReason: string | null; decisionReasonText: string | null } },
      ];
      expect(recordArgs.after).toMatchObject({
        decisionReason: 'ai_generated',
        decisionReasonText: null,
      });
      expect(notify).toHaveBeenCalledWith(USER_ID, 'provenance_decision', {
        provenanceDecision: 'rejected',
        decisionReason: 'ai_generated',
        reason: undefined,
      });
    });

    it('notifies the image owner on flag with the decisionReasonText but never the admin note', async () => {
      const { service, findById, findUniqueOrThrow, notify } = buildService();
      findById.mockResolvedValue(fakeRow());
      findUniqueOrThrow.mockResolvedValue(fakeRow());

      await service.decide(
        { id: ADMIN_ID },
        CHECK_ID,
        {
          status: 'flagged',
          note: 'admin-internal detail, never sent to the photographer',
          decisionReason: 'other',
          decisionReasonText: 'Watermark from a stock library',
        },
        '1.2.3.4',
      );

      expect(notify).toHaveBeenCalledWith(USER_ID, 'provenance_decision', {
        provenanceDecision: 'flagged',
        decisionReason: 'other',
        reason: 'Watermark from a stock library',
      });
      const [, , payload] = notify.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(JSON.stringify(payload)).not.toContain('admin-internal detail');
    });
  });

  describe('recheck', () => {
    it('throws 404 when the check does not exist', async () => {
      const { service, findById } = buildService();
      findById.mockResolvedValue(null);

      await expect(service.recheck({ id: ADMIN_ID }, CHECK_ID, '1.2.3.4')).rejects.toMatchObject({
        status: 404,
        response: { code: 'NOT_FOUND' },
      });
    });

    it('writes an audit row and enqueues a forced provenance check', async () => {
      const { service, findById, record, enqueue } = buildService();
      findById.mockResolvedValue(fakeRow());

      await service.recheck({ id: ADMIN_ID }, CHECK_ID, '1.2.3.4');

      expect(record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorId: ADMIN_ID,
          action: 'provenance.recheck',
          targetType: 'ProvenanceCheck',
          targetId: CHECK_ID,
        }),
      );
      expect(enqueue).toHaveBeenCalledWith({ portfolioImageId: PORTFOLIO_IMAGE_ID, force: true });
    });
  });
});
