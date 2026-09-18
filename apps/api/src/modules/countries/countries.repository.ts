import { Inject, Injectable } from '@nestjs/common';
import type { Country, Prisma } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface CountryRow {
  code: string;
  name: string;
  currency: string;
  defaultLocale: string;
}

@Injectable()
export class CountriesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listEnabled(): Promise<CountryRow[]> {
    return this.prisma.client.country.findMany({
      where: { enabled: true },
      select: { code: true, name: true, currency: true, defaultLocale: true },
      orderBy: { name: 'asc' },
    });
  }

  async findEnabledByCode(code: string) {
    return this.prisma.client.country.findFirst({ where: { code, enabled: true } });
  }

  findByCode(code: string): Promise<Country | null> {
    return this.prisma.client.country.findUnique({ where: { code } });
  }

  async listAllWithAccountCounts(): Promise<{ country: Country; accountCount: number }[]> {
    const [countries, counts] = await Promise.all([
      this.prisma.client.country.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.client.user.groupBy({
        by: ['countryCode'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
    ]);
    const byCode = new Map(counts.map((row) => [row.countryCode, row._count._all]));
    return countries.map((country) => ({
      country,
      accountCount: byCode.get(country.code) ?? 0,
    }));
  }

  countAccounts(code: string): Promise<number> {
    return this.prisma.client.user.count({ where: { countryCode: code, deletedAt: null } });
  }

  update(tx: Prisma.TransactionClient, code: string, data: Prisma.CountryUpdateInput) {
    return tx.country.update({ where: { code }, data });
  }
}
