import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PortfolioImageStatus, ProvenanceVerdict } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AdminProvenanceCursor } from './admin-provenance-cursor.js';

export interface AdminProvenanceFilters {
  verdict?: ProvenanceVerdict;
  status?: PortfolioImageStatus;
  cursor?: AdminProvenanceCursor;
  limit: number;
}

export const withPortfolioImage = {
  portfolioImage: {
    include: {
      profile: true,
      upload: true,
    },
  },
} satisfies Prisma.ProvenanceCheckInclude;

export type ProvenanceCheckWithRelations = Prisma.ProvenanceCheckGetPayload<{
  include: typeof withPortfolioImage;
}>;

function cursorWhere(cursor: AdminProvenanceCursor): Prisma.ProvenanceCheckWhereInput {
  const createdAt = new Date(cursor.createdAt);
  return {
    createdAt: { gte: createdAt },
    OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: cursor.id } }],
  };
}

@Injectable()
export class AdminProvenanceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(filters: AdminProvenanceFilters): Promise<ProvenanceCheckWithRelations[]> {
    const and: Prisma.ProvenanceCheckWhereInput[] = [];
    if (filters.verdict) {
      and.push({ verdict: filters.verdict });
    }
    if (filters.status) {
      and.push({ portfolioImage: { status: filters.status } });
    }
    if (filters.cursor) {
      and.push(cursorWhere(filters.cursor));
    }
    const where: Prisma.ProvenanceCheckWhereInput = and.length > 0 ? { AND: and } : {};

    return this.prisma.client.provenanceCheck.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: filters.limit + 1,
      include: withPortfolioImage,
    });
  }

  findById(id: string): Promise<ProvenanceCheckWithRelations | null> {
    return this.prisma.client.provenanceCheck.findUnique({
      where: { id },
      include: withPortfolioImage,
    });
  }
}
