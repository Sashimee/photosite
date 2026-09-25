import { Inject, Injectable } from '@nestjs/common';
import type {
  DataRequestChannel,
  DataRequestStatus,
  DataRequestType,
  Prisma,
  UserRole,
  UserStatus,
} from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AdminDataRequestCursor } from './admin-data-request-cursor.js';

export interface AdminDataRequestFilters {
  status?: DataRequestStatus;
  type?: DataRequestType;
  channel?: DataRequestChannel;
  userId?: string;
  cursor?: AdminDataRequestCursor;
  limit: number;
}

// `exportKey` never leaves the database via this select (docs/steps/1D.2-admin-users.md
// "Support never receives export bytes, and exportKey is never mapped").
const dataRequestSelect = {
  id: true,
  type: true,
  status: true,
  channel: true,
  requestedAt: true,
  receivedAt: true,
  completedAt: true,
  expiresAt: true,
  failureReason: true,
  cancelledAt: true,
  user: { select: { id: true, email: true, country: { select: { timezone: true } } } },
} satisfies Prisma.DataRequestSelect;

export type AdminDataRequestRow = Prisma.DataRequestGetPayload<{
  select: typeof dataRequestSelect;
}>;

function cursorWhere(cursor: AdminDataRequestCursor): Prisma.DataRequestWhereInput {
  const requestedAt = new Date(cursor.requestedAt);
  // Redundant with the OR; gives Postgres a start bound on DataRequest_requestedAt_id_idx.
  return {
    requestedAt: { lte: requestedAt },
    OR: [{ requestedAt: { lt: requestedAt } }, { requestedAt, id: { lt: cursor.id } }],
  };
}

export interface SuccessfulExport {
  userId: string;
  requestedAt: Date;
  completedAt: Date | null;
  status: DataRequestStatus;
  expiresAt: Date | null;
}

@Injectable()
export class AdminDataRequestsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Batched over every user on the page, so working out whether a retry already
  // answered a failed export costs one query per page, not one per row.
  async listSuccessfulExports(userIds: string[]): Promise<SuccessfulExport[]> {
    if (userIds.length === 0) {
      return [];
    }
    return this.prisma.client.dataRequest.findMany({
      where: { userId: { in: userIds }, type: 'export', status: { in: ['ready', 'completed'] } },
      select: { userId: true, requestedAt: true, completedAt: true, status: true, expiresAt: true },
    });
  }

  async findById(id: string): Promise<AdminDataRequestRow | null> {
    return this.prisma.client.dataRequest.findUnique({ where: { id }, select: dataRequestSelect });
  }

  async findByIdInTx(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<AdminDataRequestRow | null> {
    return tx.dataRequest.findUnique({ where: { id }, select: dataRequestSelect });
  }

  async findUserStatus(userId: string): Promise<UserStatus | null> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    return user?.status ?? null;
  }

  async findUserForOffline(
    userId: string,
  ): Promise<{ id: string; email: string; status: UserStatus; roles: UserRole[] } | null> {
    return this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, status: true, roles: true },
    });
  }

  async hasAnyAdminPermissionGrant(userId: string): Promise<boolean> {
    const grant = await this.prisma.client.adminPermissionGrant.findFirst({
      where: { userId },
      select: { id: true },
    });
    return grant !== null;
  }

  async findOpenRequestForUser(
    userId: string,
    type: DataRequestType,
  ): Promise<{ id: string } | null> {
    return this.prisma.client.dataRequest.findFirst({
      where: { userId, type, status: { in: ['pending', 'processing'] } },
      select: { id: true },
    });
  }

  // Re-read inside the transaction that creates the retry row, so a status
  // change that lands between the pre-check and the write can't slip through.
  async findUserStatusInTx(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<UserStatus | null> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
    return user?.status ?? null;
  }

  async findOpenExportForUser(userId: string): Promise<{ id: string } | null> {
    return this.prisma.client.dataRequest.findFirst({
      where: { userId, type: 'export', status: { in: ['pending', 'processing'] } },
      select: { id: true },
    });
  }

  // `before.sourceId` is set by AdminDataRequestsService.retryExport on every
  // retry audit row, so this is the source of truth for "has this exact
  // failed export already been retried".
  async findRetryAuditForSource(sourceId: string): Promise<{ id: string } | null> {
    return this.prisma.client.auditLog.findFirst({
      where: {
        action: 'data_request.export_retried',
        before: { path: ['sourceId'], equals: sourceId },
      },
      select: { id: true },
    });
  }

  async createExport(tx: Prisma.TransactionClient, userId: string): Promise<AdminDataRequestRow> {
    return tx.dataRequest.create({
      data: { userId, type: 'export', status: 'pending' },
      select: dataRequestSelect,
    });
  }

  async createOfflineExport(
    tx: Prisma.TransactionClient,
    userId: string,
    channel: DataRequestChannel,
    receivedAt: Date,
  ): Promise<AdminDataRequestRow> {
    return tx.dataRequest.create({
      data: { userId, type: 'export', status: 'pending', channel, receivedAt },
      select: dataRequestSelect,
    });
  }

  async list(filters: AdminDataRequestFilters): Promise<AdminDataRequestRow[]> {
    const and: Prisma.DataRequestWhereInput[] = [];
    if (filters.status) {
      and.push({ status: filters.status });
    }
    if (filters.type) {
      and.push({ type: filters.type });
    }
    if (filters.channel) {
      and.push({ channel: filters.channel });
    }
    if (filters.userId) {
      and.push({ userId: filters.userId });
    }
    if (filters.cursor) {
      and.push(cursorWhere(filters.cursor));
    }
    const where: Prisma.DataRequestWhereInput = and.length > 0 ? { AND: and } : {};

    return this.prisma.client.dataRequest.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: filters.limit + 1,
      select: dataRequestSelect,
    });
  }
}
