import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { CreateReportRequestSchema } from '@photoo/shared';
import type { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service.js';
import { reportTargetExists } from './report-targets.js';
import { ReportsRateLimitService } from './reports-rate-limit.service.js';

type CreateReportInput = z.infer<typeof CreateReportRequestSchema>;

function targetNotFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Target not found' }, 404);
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ReportsRateLimitService) private readonly rateLimit: ReportsRateLimitService,
  ) {}

  async create(
    input: CreateReportInput,
    reporterId: string | null,
    ip: string | undefined,
  ): Promise<void> {
    await this.rateLimit.enforce(ip, reporterId);

    const exists = await reportTargetExists(this.prisma.client, input.targetType, input.targetId);
    if (!exists) {
      throw targetNotFound();
    }

    if (reporterId) {
      // An authenticated reporter's second notice on a target that already
      // has an open report from them is accepted, not rejected with a
      // 409: the first notice already reached the queue, so there is
      // nothing to fail. It is folded into the existing report instead of
      // creating a duplicate row for the admin queue to re-triage.
      // Anonymous reports skip this check entirely - there is no reporter
      // identity to de-duplicate against without fingerprinting a
      // signed-out visitor, which is worse than an occasional duplicate.
      const duplicate = await this.prisma.client.report.findFirst({
        where: {
          reporterId,
          targetType: input.targetType,
          targetId: input.targetId,
          status: 'open',
        },
        select: { id: true },
      });
      if (duplicate) {
        return;
      }
    }

    await this.prisma.client.report.create({
      data: {
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
      },
    });
  }
}
