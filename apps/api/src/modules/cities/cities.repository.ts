import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface CityGroupRow {
  name: string;
  countryCode: string;
  count: number;
}

@Injectable()
export class CitiesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Grouped by the lowercased city so two profiles that differ only in
  // casing ("Luxembourg" vs "LUXEMBOURG") collapse into one city instead of
  // producing two entries that would slugify to the same value; `q` and
  // accent-folding are applied in TypeScript over this (small, bounded by
  // distinct cities) result, see cities.service.ts.
  async groupPublishedCities(countryCode: string | undefined): Promise<CityGroupRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`p."isPublished" = true`,
      Prisma.sql`p."deletedAt" IS NULL`,
    ];
    if (countryCode !== undefined) {
      conditions.push(Prisma.sql`p."countryCode" = ${countryCode}`);
    }

    return this.prisma.client.$queryRaw<CityGroupRow[]>`
      SELECT
        MIN(p.city) AS "name",
        p."countryCode" AS "countryCode",
        COUNT(*)::int AS "count"
      FROM "PhotographerProfile" p
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY lower(p.city), p."countryCode"
    `;
  }
}
