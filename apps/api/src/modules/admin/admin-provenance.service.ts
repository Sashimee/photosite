import { HttpException, Inject, Injectable } from '@nestjs/common';
import type {
  AdminProvenanceCheckSchema,
  AdminProvenanceCheckSummarySchema,
  AdminProvenanceQuerySchema,
  ProvenanceDecisionRequestSchema,
} from '@photoo/shared';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProvenanceCheckQueueService } from '../profiles/provenance-check-queue.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import {
  decodeAdminProvenanceCursor,
  encodeAdminProvenanceCursor,
} from './admin-provenance-cursor.js';
import {
  mapAdminProvenanceCheck,
  mapAdminProvenanceCheckSummary,
} from './admin-provenance-mapper.js';
import { AdminProvenanceRepository, withPortfolioImage } from './admin-provenance.repository.js';
import type { z } from 'zod';

type ProvenanceQuery = z.infer<typeof AdminProvenanceQuerySchema>;
type ProvenanceCheckSummaryDto = z.infer<typeof AdminProvenanceCheckSummarySchema>;
type ProvenanceCheckDto = z.infer<typeof AdminProvenanceCheckSchema>;
type DecisionRequest = z.infer<typeof ProvenanceDecisionRequestSchema>;

interface AdminActor {
  id: string;
}

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Provenance check not found' }, 404);
}

@Injectable()
export class AdminProvenanceService {
  private readonly baseUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminProvenanceRepository) private readonly repository: AdminProvenanceRepository,
    @Inject(AdminAuditService) private readonly auditService: AdminAuditService,
    @Inject(ProvenanceCheckQueueService)
    private readonly provenanceQueue: ProvenanceCheckQueueService,
    @Inject(APP_CONFIG) config: Env,
  ) {
    this.baseUrl = config.S3_PUBLIC_BASE_URL;
  }

  async list(
    query: ProvenanceQuery,
  ): Promise<{ items: ProvenanceCheckSummaryDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeAdminProvenanceCursor(query.cursor) : undefined;
    const rows = await this.repository.list({
      ...(query.verdict ? { verdict: query.verdict } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(cursor ? { cursor } : {}),
      limit: query.limit,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeAdminProvenanceCursor(last.createdAt, last.id) : null;

    return {
      items: page.map((row) => mapAdminProvenanceCheckSummary(row, this.baseUrl)),
      nextCursor,
    };
  }

  async getById(id: string): Promise<ProvenanceCheckDto> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw notFound();
    }
    return mapAdminProvenanceCheck(row, this.baseUrl);
  }

  // An admin decision can be revised (e.g. correcting an earlier call), so
  // there is no "already decided" precondition here, only that the check
  // itself must exist; every decision still gets its own audit row.
  async decide(
    admin: AdminActor,
    id: string,
    body: DecisionRequest,
    ip: string | undefined,
  ): Promise<ProvenanceCheckDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw notFound();
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const reviewedAt = new Date();
      await tx.provenanceCheck.update({
        where: { id },
        data: { reviewedByAdminId: admin.id, reviewedAt, note: body.note },
      });
      await tx.portfolioImage.update({
        where: { id: existing.portfolioImageId },
        data: { status: body.status },
      });

      await this.auditService.record(tx, {
        actorId: admin.id,
        action: 'provenance.decision',
        targetType: 'ProvenanceCheck',
        targetId: id,
        before: {
          portfolioImageStatus: existing.portfolioImage.status,
          reviewedByAdminId: existing.reviewedByAdminId,
        },
        after: { portfolioImageStatus: body.status, note: body.note },
        ip: ip ?? null,
      });

      return tx.provenanceCheck.findUniqueOrThrow({
        where: { id },
        include: withPortfolioImage,
      });
    });

    return mapAdminProvenanceCheck(updated, this.baseUrl);
  }

  async recheck(
    admin: AdminActor,
    id: string,
    ip: string | undefined,
  ): Promise<ProvenanceCheckDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw notFound();
    }

    await this.prisma.client.$transaction(async (tx) => {
      await this.auditService.record(tx, {
        actorId: admin.id,
        action: 'provenance.recheck',
        targetType: 'ProvenanceCheck',
        targetId: id,
        before: null,
        after: { portfolioImageId: existing.portfolioImageId },
        ip: ip ?? null,
      });
    });

    await this.provenanceQueue.enqueue({
      portfolioImageId: existing.portfolioImageId,
      force: true,
    });

    return mapAdminProvenanceCheck(existing, this.baseUrl);
  }
}
