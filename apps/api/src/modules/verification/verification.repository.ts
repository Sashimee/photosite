import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, VerificationCaseStatus } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { VerificationCaseCursor } from './verification-cursor.js';

export const ACTIVE_CASE_STATUSES = ['draft', 'submitted', 'in_review'] as const;

export const CASE_WITH_DOCUMENTS_INCLUDE = {
  documents: { include: { upload: true }, orderBy: { createdAt: 'asc' } },
} as const;

export const CASE_WITH_DOCUMENTS_AND_PHOTOGRAPHER_INCLUDE = {
  ...CASE_WITH_DOCUMENTS_INCLUDE,
  user: {
    select: { email: true, photographerProfile: { select: { displayName: true } } },
  },
} as const;

export interface AdminListFilters {
  status?: VerificationCaseStatus;
  countryCode?: string;
  cursor?: VerificationCaseCursor;
  limit: number;
}

function cursorWhere(cursor: VerificationCaseCursor): Prisma.VerificationCaseWhereInput {
  if (cursor.submittedAt === null) {
    return { submittedAt: null, id: { gt: cursor.id } };
  }
  const submittedAt = new Date(cursor.submittedAt);
  return {
    OR: [
      { submittedAt: { gt: submittedAt } },
      { submittedAt, id: { gt: cursor.id } },
      { submittedAt: null },
    ],
  };
}

@Injectable()
export class VerificationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findOwnCase(userId: string) {
    return this.prisma.client.verificationCase.findFirst({
      where: { userId, status: { in: [...ACTIVE_CASE_STATUSES] } },
      include: CASE_WITH_DOCUMENTS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  // Unfiltered by status, unlike findOwnCase: the read path stays reachable
  // after a decision (approved/rejected/expired) so the notification link
  // and rejectionReason are never a 404 (docs/steps/1A.9-verification.md).
  findLatestCase(userId: string) {
    return this.prisma.client.verificationCase.findFirst({
      where: { userId },
      include: CASE_WITH_DOCUMENTS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string) {
    return this.prisma.client.verificationCase.findUnique({
      where: { id },
      include: CASE_WITH_DOCUMENTS_AND_PHOTOGRAPHER_INCLUDE,
    });
  }

  async list(filters: AdminListFilters) {
    const where: Prisma.VerificationCaseWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.countryCode ? { countryCode: filters.countryCode } : {}),
      ...(filters.cursor ? cursorWhere(filters.cursor) : {}),
    };

    const rows = await this.prisma.client.verificationCase.findMany({
      where,
      include: CASE_WITH_DOCUMENTS_AND_PHOTOGRAPHER_INCLUDE,
      orderBy: [{ submittedAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      take: filters.limit + 1,
    });

    return rows;
  }
}
