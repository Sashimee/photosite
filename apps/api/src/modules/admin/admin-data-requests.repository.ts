import { Inject, Injectable } from '@nestjs/common';
import type { DataRequestStatus, DataRequestType, Prisma } from '@photoo/db';
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
  return {
    OR: [{ requestedAt: { lt: requestedAt } }, { requestedAt, id: { lt: cursor.id } }],
  };
}

@Injectable()
export class AdminDataRequestsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
