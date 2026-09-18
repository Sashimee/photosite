import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, ReportStatus } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AdminReportCursor } from './admin-report-cursor.js';

export interface AdminReportFilters {
  status?: ReportStatus;
  targetType?: string;
  targetId?: string;
  cursor?: AdminReportCursor;
  limit: number;
}

function cursorWhere(cursor: AdminReportCursor): Prisma.ReportWhereInput {
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: cursor.id } }],
  };
}

@Injectable()
export class AdminReportsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(filters: AdminReportFilters) {
    const and: Prisma.ReportWhereInput[] = [];
    if (filters.status) {
      and.push({ status: filters.status });
    }
    if (filters.targetType) {
      and.push({ targetType: filters.targetType });
    }
    if (filters.targetId) {
      and.push({ targetId: filters.targetId });
    }
    if (filters.cursor) {
      and.push(cursorWhere(filters.cursor));
    }
    const where: Prisma.ReportWhereInput = and.length > 0 ? { AND: and } : {};

    return this.prisma.client.report.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: filters.limit + 1,
    });
  }

  findById(id: string) {
    return this.prisma.client.report.findUnique({ where: { id } });
  }
}
