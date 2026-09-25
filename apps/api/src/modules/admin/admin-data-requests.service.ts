import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import type { DataRequestChannel, PrismaClient, UserRole } from '@photoo/db';
import {
  type AdminDataRequestSchema,
  type AdminDataRequestsQuerySchema,
  type AdminLogDataRequestBodySchema,
  gdprResponseDueAt,
} from '@photoo/shared';
import type { z } from 'zod';
import { applyAccountDeletion } from '../gdpr/apply-account-deletion.js';
import { assertNoBlockingObligations } from '../gdpr/blocking-obligations.js';
import { DataRequestsService } from '../gdpr/data-requests.service.js';
import { GdprExportQueueService } from '../gdpr/gdpr-export-queue.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SessionContext } from '../auth/session.js';
import { AdminAccessService } from './admin-access.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import {
  decodeAdminDataRequestCursor,
  encodeAdminDataRequestCursor,
} from './admin-data-request-cursor.js';
import {
  type AdminDataRequestRow,
  AdminDataRequestsRepository,
  type SuccessfulExport,
} from './admin-data-requests.repository.js';

interface AdminActor {
  id: string;
}

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Data request not found' }, 404);
}

function protectedTarget(): HttpException {
  return new HttpException(
    {
      code: 'PROTECTED_TARGET',
      message: 'This user cannot be targeted by this action',
    },
    403,
  );
}

function conflict(code: string, message: string): HttpException {
  return new HttpException({ code, message }, 409);
}

function conflictForUserStatus(status: string | null): HttpException {
  if (status === 'suspended') {
    return conflict('USER_SUSPENDED', 'User account is suspended');
  }
  return conflict('USER_DELETED', 'User account is deleted or anonymised');
}

function conflictForOpenType(type: 'export' | 'delete'): HttpException {
  if (type === 'export') {
    return conflict('EXPORT_OPEN', 'User already has an open export request');
  }
  return conflict('DELETE_OPEN', 'User already has an open deletion request');
}

function badRequest(message: string): HttpException {
  return new HttpException({ code: 'VALIDATION_ERROR', message }, 400);
}

const RECEIVED_AT_MAX_FUTURE_SKEW_MS = 60 * 1000;
const RECEIVED_AT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function assertReceivedAtInRange(receivedAt: Date): void {
  const now = Date.now();
  if (receivedAt.getTime() > now + RECEIVED_AT_MAX_FUTURE_SKEW_MS) {
    throw badRequest('receivedAt cannot be in the future');
  }
  if (receivedAt.getTime() < now - RECEIVED_AT_MAX_AGE_MS) {
    throw badRequest('receivedAt is more than 30 days in the past');
  }
}

async function assertNoBlockingObligationsForAdmin(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  try {
    await assertNoBlockingObligations(prisma, userId);
  } catch (error) {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const code = typeof response === 'object' ? (response as { code?: unknown }).code : undefined;
      if (code === 'CONFLICT') {
        const { message, details } = response as { message?: string; details?: unknown };
        throw new HttpException({ code: 'BLOCKING_OBLIGATIONS', message, details }, 409);
      }
    }
    throw error;
  }
}

type Query = z.infer<typeof AdminDataRequestsQuerySchema>;
type DataRequestDto = z.infer<typeof AdminDataRequestSchema>;
type LogOfflineInput = z.infer<typeof AdminLogDataRequestBodySchema>;

// A `ready` export answered the request even once its download link has
// expired, so only exports that never produced a copy are still awaiting one.
function isAwaitingResponse(row: AdminDataRequestRow): boolean {
  return (
    row.type === 'export' &&
    (row.status === 'pending' || row.status === 'processing' || row.status === 'failed')
  );
}

function buildLatestSuccessByUser(rows: SuccessfulExport[]): Map<string, Date> {
  const latest = new Map<string, Date>();
  for (const row of rows) {
    const current = latest.get(row.userId);
    if (!current || row.requestedAt > current) {
      latest.set(row.userId, row.requestedAt);
    }
  }
  return latest;
}

function buildSuccessesByUser(rows: SuccessfulExport[]): Map<string, SuccessfulExport[]> {
  const byUser = new Map<string, SuccessfulExport[]>();
  for (const row of rows) {
    const current = byUser.get(row.userId);
    if (current) {
      current.push(row);
    } else {
      byUser.set(row.userId, [row]);
    }
  }
  return byUser;
}

function responseDueAt(
  row: AdminDataRequestRow,
  latestSuccessByUser: Map<string, Date>,
): Date | null {
  if (!isAwaitingResponse(row)) {
    return null;
  }
  const latestSuccess = latestSuccessByUser.get(row.user.id);
  if (latestSuccess && latestSuccess > row.requestedAt) {
    return null;
  }
  return gdprResponseDueAt(row.receivedAt, row.user.country.timezone);
}

// The Art. 12(3) clock for a failed export still runs from that row's own
// requestedAt, even when a later retry is what actually answered it.
function isFailedAnsweredLate(
  row: AdminDataRequestRow,
  successesByUser: Map<string, SuccessfulExport[]>,
): boolean {
  const laterCompletions = (successesByUser.get(row.user.id) ?? [])
    .filter((success) => success.requestedAt > row.requestedAt)
    .map((success) => success.completedAt)
    .filter((completedAt): completedAt is Date => completedAt !== null);
  if (laterCompletions.length === 0) {
    return false;
  }
  const earliest = laterCompletions.reduce((min, date) => (date < min ? date : min));
  return earliest > gdprResponseDueAt(row.receivedAt, row.user.country.timezone);
}

function isAnsweredLate(
  row: AdminDataRequestRow,
  successesByUser: Map<string, SuccessfulExport[]>,
): boolean {
  if (row.type !== 'export') {
    return false;
  }
  if (row.status === 'ready' || row.status === 'completed') {
    return (
      row.completedAt !== null &&
      row.completedAt > gdprResponseDueAt(row.receivedAt, row.user.country.timezone)
    );
  }
  if (row.status === 'failed') {
    return isFailedAnsweredLate(row, successesByUser);
  }
  return false;
}

// A retry is redundant once the user already holds a copy of the data.
function hasAlreadyAnsweredExport(
  source: AdminDataRequestRow,
  exports: SuccessfulExport[],
  now: Date,
): boolean {
  return exports.some((row) => {
    if (row.status === 'ready' && row.expiresAt && row.expiresAt > now) {
      return true;
    }
    return row.completedAt !== null && row.completedAt > source.requestedAt;
  });
}

function mapDataRequest(
  row: AdminDataRequestRow,
  latestSuccessByUser: Map<string, Date>,
  successesByUser: Map<string, SuccessfulExport[]>,
): DataRequestDto {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    channel: row.channel,
    requestedAt: row.requestedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    responseDueAt: responseDueAt(row, latestSuccessByUser)?.toISOString() ?? null,
    answeredLate: isAnsweredLate(row, successesByUser),
    user: { id: row.user.id, email: row.user.email },
  };
}

@Injectable()
export class AdminDataRequestsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminDataRequestsRepository) private readonly repository: AdminDataRequestsRepository,
    @Inject(AdminAuditService) private readonly auditService: AdminAuditService,
    @Inject(GdprExportQueueService) private readonly exportQueue: GdprExportQueueService,
    @Inject(DataRequestsService) private readonly dataRequestsService: DataRequestsService,
    @Inject(AdminAccessService) private readonly adminAccess: AdminAccessService,
  ) {}

  async list(query: Query): Promise<{ items: DataRequestDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeAdminDataRequestCursor(query.cursor) : undefined;
    const rows = await this.repository.list({
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(cursor ? { cursor } : {}),
      limit: query.limit,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeAdminDataRequestCursor(last.requestedAt, last.id) : null;

    const awaitingUserIds = [
      ...new Set(page.filter((row) => isAwaitingResponse(row)).map((row) => row.user.id)),
    ];
    const successfulExports = await this.repository.listSuccessfulExports(awaitingUserIds);
    const latestSuccessByUser = buildLatestSuccessByUser(successfulExports);
    const successesByUser = buildSuccessesByUser(successfulExports);

    return {
      items: page.map((row) => mapDataRequest(row, latestSuccessByUser, successesByUser)),
      nextCursor,
    };
  }

  // Bypasses DataRequestsRateLimitService: this is a support action, not a
  // user-initiated request, so the per-user GDPR rate limit doesn't apply.
  async retryExport(
    admin: AdminActor,
    id: string,
    ip: string | undefined,
  ): Promise<DataRequestDto> {
    const source = await this.repository.findById(id);
    if (!source) {
      throw notFound();
    }
    if (source.type !== 'export' || source.status !== 'failed') {
      throw conflict('EXPORT_NOT_FAILED', 'Only a failed export can be retried');
    }
    const userStatus = await this.repository.findUserStatus(source.user.id);
    if (userStatus !== 'active') {
      throw conflictForUserStatus(userStatus);
    }
    const alreadyRetried = await this.repository.findRetryAuditForSource(id);
    if (alreadyRetried) {
      throw conflict('EXPORT_ALREADY_RETRIED', 'This export has already been retried');
    }
    const openExport = await this.repository.findOpenExportForUser(source.user.id);
    if (openExport) {
      throw conflict('EXPORT_OPEN', 'User already has a pending or processing export');
    }
    const successfulExports = await this.repository.listSuccessfulExports([source.user.id]);
    if (hasAlreadyAnsweredExport(source, successfulExports, new Date())) {
      throw conflict('EXPORT_ALREADY_ANSWERED', 'User has already received a later export');
    }

    let created: AdminDataRequestRow;
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        const txUserStatus = await this.repository.findUserStatusInTx(tx, source.user.id);
        if (txUserStatus !== 'active') {
          throw conflictForUserStatus(txUserStatus);
        }
        const row = await this.repository.createExport(tx, source.user.id);
        await this.auditService.record(tx, {
          actorId: admin.id,
          action: 'data_request.export_retried',
          targetType: 'DataRequest',
          targetId: row.id,
          before: { sourceId: id },
          after: { status: 'pending', userId: source.user.id },
          ip: ip ?? null,
        });
        return row;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('EXPORT_OPEN', 'User already has a pending or processing export');
      }
      throw error;
    }

    try {
      await this.exportQueue.enqueue(created.id);
    } catch (error) {
      const failedUpdate = await this.prisma.client.dataRequest.updateMany({
        where: { id: created.id, status: 'pending' },
        data: { status: 'failed', failureReason: 'enqueue_failed' },
      });
      if (failedUpdate.count === 1) {
        await this.auditService.record(this.prisma.client, {
          actorId: admin.id,
          action: 'data_request.export_failed',
          targetType: 'DataRequest',
          targetId: created.id,
          after: { status: 'failed', reason: 'enqueue_failed' },
          ip: ip ?? null,
        });
      }
      throw error;
    }

    return mapDataRequest(created, new Map(), new Map());
  }

  async logOffline(
    session: SessionContext,
    body: LogOfflineInput,
    ip: string | undefined,
  ): Promise<DataRequestDto> {
    const receivedAt = new Date(body.receivedAt);
    assertReceivedAtInRange(receivedAt);

    const user = await this.repository.findUserForOffline(body.userId);
    if (!user) {
      throw notFound();
    }
    await this.assertTargetNotProtected(session, user);
    if (user.status !== 'active') {
      throw conflictForUserStatus(user.status);
    }
    const openRequest = await this.repository.findOpenRequestForUser(body.userId, body.type);
    if (openRequest) {
      throw conflictForOpenType(body.type);
    }

    const admin: AdminActor = { id: session.user.id };
    if (body.type === 'export') {
      return this.logOfflineExport(admin, user, body.channel, receivedAt, ip);
    }
    return this.logOfflineDeletion(admin, user, body.channel, receivedAt, ip);
  }

  // #417: an admin can't self-target or reach into another admin's account
  // through the offline logging endpoint, unless they're a superadmin acting
  // with a fresh second factor (AdminAccessService.isSuperadminWithFreshTwoFactor).
  private async assertTargetNotProtected(
    session: SessionContext,
    target: { id: string; roles: UserRole[] },
  ): Promise<void> {
    const isProtected =
      target.id === session.user.id ||
      target.roles.includes('admin') ||
      (await this.repository.hasAnyAdminPermissionGrant(target.id));
    if (!isProtected) {
      return;
    }
    if (await this.adminAccess.isSuperadminWithFreshTwoFactor(session)) {
      return;
    }
    throw protectedTarget();
  }

  private async logOfflineExport(
    admin: AdminActor,
    user: { id: string; email: string },
    channel: DataRequestChannel,
    receivedAt: Date,
    ip: string | undefined,
  ): Promise<DataRequestDto> {
    let created: AdminDataRequestRow;
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        const status = await this.repository.findUserStatusInTx(tx, user.id);
        if (status !== 'active') {
          throw conflictForUserStatus(status);
        }
        const row = await this.repository.createOfflineExport(tx, user.id, channel, receivedAt);
        await this.auditService.record(tx, {
          actorId: admin.id,
          action: 'data_request.logged_offline',
          targetType: 'DataRequest',
          targetId: row.id,
          after: {
            type: 'export',
            channel,
            receivedAt: receivedAt.toISOString(),
            userId: user.id,
          },
          ip: ip ?? null,
        });
        return row;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflictForOpenType('export');
      }
      throw error;
    }

    try {
      await this.exportQueue.enqueue(created.id);
    } catch (error) {
      const failedUpdate = await this.prisma.client.dataRequest.updateMany({
        where: { id: created.id, status: 'pending' },
        data: { status: 'failed', failureReason: 'enqueue_failed' },
      });
      if (failedUpdate.count === 1) {
        await this.auditService.record(this.prisma.client, {
          actorId: admin.id,
          action: 'data_request.export_failed',
          targetType: 'DataRequest',
          targetId: created.id,
          after: { status: 'failed', reason: 'enqueue_failed' },
          ip: ip ?? null,
        });
      }
      throw error;
    }

    return mapDataRequest(created, new Map(), new Map());
  }

  private async logOfflineDeletion(
    admin: AdminActor,
    user: { id: string; email: string },
    channel: DataRequestChannel,
    receivedAt: Date,
    ip: string | undefined,
  ): Promise<DataRequestDto> {
    await assertNoBlockingObligationsForAdmin(this.prisma.client, user.id);

    let created: AdminDataRequestRow | null;
    try {
      created = await this.prisma.client.$transaction(async (tx) => {
        const row = await applyAccountDeletion(tx, {
          userId: user.id,
          receivedAt,
          channel,
          audit: {
            actorType: 'admin',
            actorId: admin.id,
            action: 'data_request.logged_offline',
            extraAfter: { channel, receivedAt: receivedAt.toISOString() },
            ip: ip ?? null,
          },
        });
        return this.repository.findByIdInTx(tx, row.id);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflictForOpenType('delete');
      }
      throw error;
    }
    if (!created) {
      throw notFound();
    }

    await this.dataRequestsService.runPostDeletionSideEffects(user, created.id);

    return mapDataRequest(created, new Map(), new Map());
  }
}
