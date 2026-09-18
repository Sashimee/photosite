import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { AdminReportSchema, AdminReportsQuerySchema } from '@photoo/shared';
import type { Report } from '@photoo/db';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { takeDownReportTarget } from '../reports/report-targets.js';
import { AdminAuditService } from './admin-audit.service.js';
import { decodeAdminReportCursor, encodeAdminReportCursor } from './admin-report-cursor.js';
import { AdminReportsRepository } from './admin-reports.repository.js';

type ReportsQuery = z.infer<typeof AdminReportsQuerySchema>;
type ReportDto = z.infer<typeof AdminReportSchema>;

interface AdminActor {
  id: string;
}

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Report not found' }, 404);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

function mapReport(report: Report): ReportDto {
  return {
    id: report.id,
    reporterId: report.reporterId,
    targetType: report.targetType,
    targetId: report.targetId,
    reason: report.reason,
    status: report.status,
    adminId: report.adminId,
    resolution: report.resolution,
  };
}

@Injectable()
export class AdminReportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminReportsRepository) private readonly repository: AdminReportsRepository,
    @Inject(AdminAuditService) private readonly auditService: AdminAuditService,
  ) {}

  async list(query: ReportsQuery): Promise<{ items: ReportDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeAdminReportCursor(query.cursor) : undefined;
    const rows = await this.repository.list({
      ...(query.status ? { status: query.status } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(cursor ? { cursor } : {}),
      limit: query.limit,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeAdminReportCursor(last.createdAt, last.id) : null;

    return { items: page.map(mapReport), nextCursor };
  }

  async resolve(
    admin: AdminActor,
    id: string,
    status: 'resolved' | 'dismissed',
    resolution: string,
    ip: string | undefined,
  ): Promise<ReportDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw notFound();
    }
    if (existing.status !== 'open') {
      throw conflict('Report already resolved');
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.report.updateMany({
        where: { id, status: 'open' },
        data: { status, adminId: admin.id, resolution },
      });
      if (result.count === 0) {
        throw conflict('Report already resolved');
      }

      await this.auditService.record(tx, {
        actorId: admin.id,
        action: status === 'resolved' ? 'report.resolved' : 'report.dismissed',
        targetType: 'Report',
        targetId: id,
        before: { status: existing.status },
        after: { status, resolution },
        ip: ip ?? null,
      });

      return tx.report.findUniqueOrThrow({ where: { id } });
    });

    return mapReport(updated);
  }

  // Resolving and taking down the target happen in one transaction, so a
  // report can never end up "resolved" while its target is still live, or
  // "open" while the target has already been removed.
  async takedown(
    admin: AdminActor,
    id: string,
    resolution: string,
    ip: string | undefined,
  ): Promise<ReportDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw notFound();
    }
    if (existing.status !== 'open') {
      throw conflict('Report already resolved');
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.report.updateMany({
        where: { id, status: 'open' },
        data: { status: 'resolved', adminId: admin.id, resolution },
      });
      if (result.count === 0) {
        throw conflict('Report already resolved');
      }

      const targetRemoved = await takeDownReportTarget(tx, existing.targetType, existing.targetId);

      await this.auditService.record(tx, {
        actorId: admin.id,
        action: 'report.takedown',
        targetType: 'Report',
        targetId: id,
        before: { status: existing.status },
        after: {
          status: 'resolved',
          resolution,
          targetType: existing.targetType,
          targetId: existing.targetId,
          targetRemoved,
        },
        ip: ip ?? null,
      });

      return tx.report.findUniqueOrThrow({ where: { id } });
    });

    return mapReport(updated);
  }
}
