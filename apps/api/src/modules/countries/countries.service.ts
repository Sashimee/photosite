import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  CountrySummarySchema,
  RequiredDocumentSchema,
  VerificationRequirementsResponseSchema,
} from '@photoo/shared';
import type { z } from 'zod';
import { CountriesRepository } from './countries.repository.js';

type CountrySummary = z.infer<typeof CountrySummarySchema>;
type VerificationRequirements = z.infer<typeof VerificationRequirementsResponseSchema>;

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Country not found' }, 404);
}

@Injectable()
export class CountriesService {
  constructor(@Inject(CountriesRepository) private readonly repository: CountriesRepository) {}

  async list(): Promise<CountrySummary[]> {
    const rows = await this.repository.listEnabled();
    return rows.map((row) => CountrySummarySchema.parse(row));
  }

  async getVerificationRequirements(code: string): Promise<VerificationRequirements> {
    const country = await this.repository.findEnabledByCode(code);
    if (!country) {
      throw notFound();
    }
    return VerificationRequirementsResponseSchema.parse({
      countryCode: country.code,
      documents: RequiredDocumentSchema.array().parse(country.requiredDocuments),
    });
  }
}
