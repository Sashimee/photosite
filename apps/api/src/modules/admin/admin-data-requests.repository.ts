import { Inject, Injectable } from '@nestjs/common';
import type { DataRequestStatus, DataRequestType, Prisma, UserStatus } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AdminDataRequestCursor } from './admin-data-request-cursor.js';

export interface AdminDataRequestFilters {
  status?: DataRequestStatus;
  type?: DataRequestType;
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
  requestedAt: true,
  completedAt: true,
  expiresAt: true,
  failureReason: true,
  cancelledAt: true,
  user: { select: { id: true, email: true } },
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
      select: { userId: true, requestedAt: true, completedAt: true },
    });
  }

  async findById(id: string): Promise<AdminDataRequestRow | null> {
    return this.prisma.client.dataRequest.findUnique({ where: { id }, select: dataRequestSelect });
  }

  async findUserStatus(userId: string): Promise<UserStatus | null> {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    return user?.status ?? null;
  }

  async findOpenExportForUser(userId: string): Promise<{ id: string } | null> {
    return this.prisma.client.dataRequest.findFirst({
      where: { userId, type: 'export', status: { in: ['pending', 'processing'] } },
      select: { id: true },
    });
  }

  async createExport(tx: Prisma.TransactionClient, userId: string): Promise<AdminDataRequestRow> {
    return tx.dataRequest.create({
      data: { userId, type: 'export', status: 'pending' },
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
