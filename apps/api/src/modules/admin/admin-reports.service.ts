import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  MODERATOR_INITIATED_REPORT_REASON,
  type AdminReportSchema,
  type AdminReportsQuerySchema,
  type DirectTakedownTargetTypeSchema,
  type NotificationType,
} from '@photoo/shared';
import type { PrismaClient, Report } from '@photoo/db';
import type { z } from 'zod';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  buildReportTargetSummary,
  getReportTargetOwnerId,
  reportTargetExists,
  restoreReportTarget,
  takeDownReportTarget,
} from '../reports/report-targets.js';
import { AdminAuditService } from './admin-audit.service.js';
import { decodeAdminReportCursor, encodeAdminReportCursor } from './admin-report-cursor.js';
import { AdminReportsRepository } from './admin-reports.repository.js';

type ReportsQuery = z.infer<typeof AdminReportsQuerySchema>;
type ReportDto = z.infer<typeof AdminReportSchema>;
type DirectTakedownTargetType = z.infer<typeof DirectTakedownTargetTypeSchema>;
type ModerationOutcome = 'resolved' | 'dismissed' | 'takedown' | 'restored';

interface AdminActor {
  id: string;
}

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Report not found' }, 404);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

async function mapReport(
  report: Report,
  client: PrismaClient,
  baseUrl: string,
): Promise<ReportDto> {
  const target = await buildReportTargetSummary(
    client,
    report.targetType,
    report.targetId,
    baseUrl,
  );
  return {
    id: report.id,
    reporterId: report.reporterId,
    targetType: report.targetType,
    targetId: report.targetId,
    reason: report.reason,
    status: report.status,
    adminId: report.adminId,
    resolution: report.resolution,
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.status === 'open' ? null : report.updatedAt.toISOString(),
    target,
  };
}

@Injectable()
export class AdminReportsService {
  private readonly baseUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminReportsRepository) private readonly repository: AdminReportsRepository,
    @Inject(AdminAuditService) private readonly auditService: AdminAuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) config: Env,
  ) {
    this.baseUrl = config.S3_PUBLIC_BASE_URL;
  }

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

    const items = await Promise.all(
      page.map((report) => mapReport(report, this.prisma.client, this.baseUrl)),
    );
    return { items, nextCursor };
  }

  async getById(id: string): Promise<ReportDto> {
    const report = await this.repository.findById(id);
    if (!report) {
      throw notFound();
    }
    return mapReport(report, this.prisma.client, this.baseUrl);
  }

  // Notifies the reporter (if any) and the target's current owner (if any)
  // with the same statement of reasons an admin wrote for the decision
  // (docs/COMPLIANCE.md DSA notice-and-action). The two can be the same
  // person or absent entirely; either way each gets at most one notice.
  private async notifyDecision(
    report: { reporterId: string | null; targetType: string; targetId: string },
    outcome: ModerationOutcome,
    resolution: string,
  ): Promise<void> {
    const ownerId = await getReportTargetOwnerId(
      this.prisma.client,
      report.targetType,
      report.targetId,
    );
    const recipients: { userId: string; type: NotificationType }[] = [];
    if (report.reporterId) {
      recipients.push({ userId: report.reporterId, type: 'report_decision' });
    }
    if (ownerId && ownerId !== report.reporterId) {
      recipients.push({ userId: ownerId, type: 'moderation_action' });
    }

    for (const recipient of recipients) {
      await this.notifications.notify(recipient.userId, recipient.type, {
        reason: resolution,
        moderationOutcome: outcome,
      });
    }
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

    await this.notifyDecision(existing, status, resolution);

    return mapReport(updated, this.prisma.client, this.baseUrl);
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

    await this.notifyDecision(existing, 'takedown', resolution);

    return mapReport(updated, this.prisma.client, this.baseUrl);
  }

  // Does not touch the report row (docs/steps/1D.6-moderation.md "does not
  // reopen the report"): the 409 comes only from `restoreReportTarget`'s own
  // `deletedAt` check.
  async restore(
    admin: AdminActor,
    id: string,
    resolution: string,
    ip: string | undefined,
  ): Promise<ReportDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw notFound();
    }

    await this.prisma.client.$transaction(async (tx) => {
      const targetRestored = await restoreReportTarget(tx, existing.targetType, existing.targetId);
      if (!targetRestored) {
        throw conflict('Report target was not taken down');
      }

      await this.auditService.record(tx, {
        actorId: admin.id,
        action: 'report.restored',
        targetType: 'Report',
        targetId: id,
        before: { targetType: existing.targetType, targetId: existing.targetId, deletedAt: true },
        after: { deletedAt: false, resolution },
        ip: ip ?? null,
      });
    });

    await this.notifyDecision(existing, 'restored', resolution);

    return mapReport(existing, this.prisma.client, this.baseUrl);
  }

  // D25 (docs/DECISIONS.md): a takedown a moderator found without a public
  // report synthesises a Report (`reporterId: null`, already `resolved`)
  // rather than being a parallel action, so it gets the exact same audit
  // trail, statement of reasons and restore path as a reported one, and
  // shows up in the same queue by `targetId`.
  async directTakedown(
    admin: AdminActor,
    targetType: DirectTakedownTargetType,
    targetId: string,
    resolution: string,
    ip: string | undefined,
  ): Promise<ReportDto> {
    const exists = await reportTargetExists(this.prisma.client, targetType, targetId);
    if (!exists) {
      throw notFound();
    }

    const created = await this.prisma.client.$transaction(async (tx) => {
      const report = await tx.report.create({
        data: {
          reporterId: null,
          targetType,
          targetId,
          reason: MODERATOR_INITIATED_REPORT_REASON,
          status: 'resolved',
          adminId: admin.id,
          resolution,
        },
      });

      const targetRemoved = await takeDownReportTarget(tx, targetType, targetId);

      await this.auditService.record(tx, {
        actorId: admin.id,
        action: 'report.direct_takedown',
        targetType: 'Report',
        targetId: report.id,
        before: null,
        after: { status: 'resolved', resolution, targetType, targetId, targetRemoved },
        ip: ip ?? null,
      });

      return report;
    });

    await this.notifyDecision({ reporterId: null, targetType, targetId }, 'takedown', resolution);

    return mapReport(created, this.prisma.client, this.baseUrl);
  }
}
