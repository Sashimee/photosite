import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface QuotePhotographerRow {
  id: string;
  slug: string;
  displayName: string;
  avatarVariants: Record<string, string> | null;
  city: string;
  countryCode: string;
  ratingAvg: number;
  ratingCount: number;
}

@Injectable()
export class QuotesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findPhotographerSummaries(
    photographerIds: readonly string[],
  ): Promise<Map<string, QuotePhotographerRow>> {
    const ids = [...new Set(photographerIds)];
    if (ids.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.client.photographerProfile.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        slug: true,
        displayName: true,
        city: true,
        countryCode: true,
        ratingAvg: true,
        ratingCount: true,
        avatarUpload: { select: { variants: true } },
      },
    });

    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          slug: row.slug,
          displayName: row.displayName,
          avatarVariants: (row.avatarUpload?.variants as Record<string, string> | null) ?? null,
          city: row.city,
          countryCode: row.countryCode,
          ratingAvg: Number(row.ratingAvg),
          ratingCount: row.ratingCount,
        },
      ]),
    );
  }
}
