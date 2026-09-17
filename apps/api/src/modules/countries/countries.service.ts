import { Inject, Injectable } from '@nestjs/common';
import { CountrySummarySchema } from '@photoo/shared';
import type { z } from 'zod';
import { CountriesRepository } from './countries.repository.js';

type CountrySummary = z.infer<typeof CountrySummarySchema>;

@Injectable()
export class CountriesService {
  constructor(@Inject(CountriesRepository) private readonly repository: CountriesRepository) {}

  async list(): Promise<CountrySummary[]> {
    const rows = await this.repository.listEnabled();
    return rows.map((row) => CountrySummarySchema.parse(row));
  }
}
