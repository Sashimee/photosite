import { Inject, Injectable } from '@nestjs/common';
import { CitySummarySchema, slugify, type CitiesQuerySchema } from '@photoo/shared';
import type { z } from 'zod';
import { CitiesRepository } from './cities.repository.js';

type Query = z.infer<typeof CitiesQuerySchema>;
type CitySummary = z.infer<typeof CitySummarySchema>;

function foldForCompare(value: string): string {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

@Injectable()
export class CitiesService {
  constructor(@Inject(CitiesRepository) private readonly repository: CitiesRepository) {}

  async list(query: Query): Promise<CitySummary[]> {
    const groups = await this.repository.groupPublishedCities(query.countryCode);

    const foldedQuery = query.q !== undefined ? foldForCompare(query.q) : undefined;
    const matching =
      foldedQuery === undefined
        ? groups
        : groups.filter((group) => foldForCompare(group.name).startsWith(foldedQuery));

    return matching
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, query.limit)
      .map((group) =>
        CitySummarySchema.parse({
          slug: slugify(group.name, { minLength: 1, fallback: 'city' }),
          name: group.name,
          countryCode: group.countryCode,
          photographerCount: group.count,
          location: { lat: group.lat, lng: group.lng },
        }),
      );
  }
}
