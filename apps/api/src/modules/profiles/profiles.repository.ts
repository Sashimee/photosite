import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import type { PhotographerCategory } from '@photoo/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SearchCursor } from './search-cursor.js';

export interface SearchFilters {
  lat?: number | undefined;
  lng?: number | undefined;
  radiusKm?: number | undefined;
  city?: string | undefined;
  countryCode?: string | undefined;
  category?: PhotographerCategory | undefined;
  language?: string | undefined;
  priceMinCents?: number | undefined;
  priceMaxCents?: number | undefined;
  limit: number;
  cursor?: SearchCursor | undefined;
}

export interface SearchResultRow {
  id: string;
  slug: string;
  displayName: string;
  headline: string | null;
  avatarVariants: Record<string, string> | null;
  categories: string[];
  languages: string[];
  city: string;
  countryCode: string;
  ratingAvg: number;
  ratingCount: number;
  minPriceCents: number | null;
  priceCurrency: string | null;
  sortValue: number;
}

interface RawSearchRow {
  id: string;
  slug: string;
  displayName: string;
  headline: string | null;
  avatarVariants: Record<string, string> | null;
  categories: string[];
  languages: string[];
  city: string;
  countryCode: string;
  ratingAvg: number;
  ratingCount: number;
  minPriceCents: number | null;
  priceCurrency: string | null;
  sortValue: number;
}

interface LocationRow {
  lat: number;
  lng: number;
}

// The grid a profile's location is snapped to before any distance is
// computed or compared, in degrees (~1km at the equator, less at higher
// latitudes): coarse enough that repeated searches from different points
// can't triangulate a profile's exact coordinates, matching the ~1km
// rounding applied to the distance itself below.
const LOCATION_GRID_DEGREES = 0.01;

@Injectable()
export class ProfilesRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Every filter is bound as a query parameter through `Prisma.sql`/tagged
  // templates; nothing here is ever built with `$queryRawUnsafe` or string
  // concatenation, including `city` and the decoded cursor.
  async search(filters: SearchFilters): Promise<SearchResultRow[]> {
    const isGeoSearch = filters.lat !== undefined && filters.lng !== undefined;

    const conditions: Prisma.Sql[] = [
      Prisma.sql`p."deletedAt" IS NULL`,
      Prisma.sql`p."isPublished" = true`,
    ];

    if (filters.city !== undefined) {
      conditions.push(Prisma.sql`lower(p.city) = lower(${filters.city})`);
    }
    if (filters.countryCode !== undefined) {
      conditions.push(Prisma.sql`p."countryCode" = ${filters.countryCode}`);
    }
    if (filters.category !== undefined) {
      conditions.push(Prisma.sql`${filters.category}::"PhotographerCategory" = ANY(p.categories)`);
    }
    if (filters.language !== undefined) {
      conditions.push(Prisma.sql`${filters.language} = ANY(p.languages)`);
    }
    if (filters.priceMinCents !== undefined) {
      conditions.push(Prisma.sql`price."minPriceCents" >= ${filters.priceMinCents}`);
    }
    if (filters.priceMaxCents !== undefined) {
      conditions.push(Prisma.sql`price."minPriceCents" <= ${filters.priceMaxCents}`);
    }

    let sortExpression: Prisma.Sql;
    let orderDirection: Prisma.Sql;
    if (isGeoSearch) {
      const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${filters.lng}, ${filters.lat}), 4326)::geography`;
      const coarseLocation = Prisma.sql`ST_SetSRID(ST_SnapToGrid(p.location::geometry, ${LOCATION_GRID_DEGREES}), 4326)::geography`;
      sortExpression = Prisma.sql`ROUND((ST_Distance(${coarseLocation}, ${point}) / 1000.0)::numeric)::float8`;
      orderDirection = Prisma.sql`ASC`;
      conditions.push(Prisma.sql`p.location IS NOT NULL`);
      if (filters.radiusKm !== undefined) {
        conditions.push(
          Prisma.sql`ST_DWithin(${coarseLocation}, ${point}, ${filters.radiusKm * 1000})`,
        );
      }
    } else {
      sortExpression = Prisma.sql`p."ratingCount"::float8`;
      orderDirection = Prisma.sql`DESC`;
    }

    if (filters.cursor) {
      const comparator = isGeoSearch ? Prisma.sql`>` : Prisma.sql`<`;
      conditions.push(
        Prisma.sql`(${sortExpression} ${comparator} ${filters.cursor.value} OR (${sortExpression} = ${filters.cursor.value} AND p.id > ${filters.cursor.id}))`,
      );
    }

    const rows = await this.prisma.client.$queryRaw<RawSearchRow[]>`
      SELECT
        p.id AS "id",
        p.slug AS "slug",
        p."displayName" AS "displayName",
        p.headline AS "headline",
        au.variants AS "avatarVariants",
        p.categories::text[] AS "categories",
        p.languages AS "languages",
        p.city AS "city",
        p."countryCode" AS "countryCode",
        p."ratingAvg"::float8 AS "ratingAvg",
        p."ratingCount" AS "ratingCount",
        price."minPriceCents" AS "minPriceCents",
        price.currency AS "priceCurrency",
        ${sortExpression} AS "sortValue"
      FROM "PhotographerProfile" p
      LEFT JOIN "Upload" au ON au.id = p."avatarUploadId"
      LEFT JOIN LATERAL (
        SELECT MIN(t."priceCents") AS "minPriceCents", MIN(t.currency) AS currency
        FROM "ProductTier" t
        JOIN "Product" pr ON pr.id = t."productId"
        WHERE pr."profileId" = p.id AND pr."isActive" = true AND pr."deletedAt" IS NULL
      ) price ON true
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY "sortValue" ${orderDirection}, p.id ASC
      LIMIT ${filters.limit + 1}
    `;

    return rows;
  }

  async setLocation(profileId: string, lat: number, lng: number): Promise<void> {
    await this.prisma.client.$executeRaw`
      UPDATE "PhotographerProfile"
      SET location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      WHERE id = ${profileId}
    `;
  }

  async getLocation(profileId: string): Promise<{ lat: number; lng: number } | null> {
    const rows = await this.prisma.client.$queryRaw<LocationRow[]>`
      SELECT ST_Y(location::geometry) AS "lat", ST_X(location::geometry) AS "lng"
      FROM "PhotographerProfile"
      WHERE id = ${profileId}
    `;
    const row = rows[0];
    return row ? { lat: row.lat, lng: row.lng } : null;
  }
}
