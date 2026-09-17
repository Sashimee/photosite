import { Inject, Injectable } from '@nestjs/common';
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
}
