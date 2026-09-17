import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@photoo/db';
import type { CreatedAtCursor } from '../../common/pagination/created-at-cursor.js';
import { PrismaService } from '../../prisma/prisma.service.js';

interface ExecuteRawClient {
  $executeRaw: PrismaClient['$executeRaw'];
}

// Matches the ~1km coarsening grid used by profile search
// (profiles.repository.ts), so a request's exact location can never be
// triangulated by a photographer browsing the feed or reading a summary.
const LOCATION_GRID_DEGREES = 0.01;

export interface RequestFullRow {
  id: string;
  clientId: string;
  title: string;
  category: string;
  description: string;
  eventDate: Date;
  dateFlexible: boolean;
  address: unknown;
  city: string;
  countryCode: string;
  budgetMinCents: number;
  budgetMaxCents: number;
  currency: string;
  usage: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  lat: number;
  lng: number;
}

export interface RequestSummaryRow {
  id: string;
  title: string;
  category: string;
  description: string;
  eventDate: Date;
  dateFlexible: boolean;
  city: string;
  countryCode: string;
  budgetMinCents: number;
  budgetMaxCents: number;
  currency: string;
  usage: string;
  status: string;
  expiresAt: Date;
  lat: number;
  lng: number;
  hasQuoted: boolean;
}

export interface RequestFeedRow extends RequestSummaryRow {
  createdAt: Date;
}

export interface FeedFilters {
  lat: number;
  lng: number;
  radiusKm: number;
  // Wire-form category labels (hyphenated, e.g. "real-estate"): cast
  // directly to the Postgres enum, matching how ProfilesRepository.search
  // casts a single category filter (toWireCategory converts Prisma's
  // underscore identifiers before this is called).
  categories: readonly string[];
  photographerProfileId: string;
  limit: number;
  cursor?: CreatedAtCursor | undefined;
}

const FULL_ROW_SELECT = Prisma.sql`
  r.id AS "id",
  r."clientId" AS "clientId",
  r.title AS "title",
  r.category::text AS "category",
  r.description AS "description",
  r."eventDate" AS "eventDate",
  r."dateFlexible" AS "dateFlexible",
  r.address AS "address",
  r.city AS "city",
  r."countryCode" AS "countryCode",
  r."budgetMinCents" AS "budgetMinCents",
  r."budgetMaxCents" AS "budgetMaxCents",
  r.currency AS "currency",
  r.usage::text AS "usage",
  r.status::text AS "status",
  r."expiresAt" AS "expiresAt",
  r."createdAt" AS "createdAt",
  ST_Y(r.location::geometry) AS "lat",
  ST_X(r.location::geometry) AS "lng"
`;

@Injectable()
export class RequestsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async setLocation(
    requestId: string,
    lat: number,
    lng: number,
    client: ExecuteRawClient = this.prisma.client,
  ): Promise<void> {
    await client.$executeRaw`
      UPDATE "Request"
      SET location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      WHERE id = ${requestId}
    `;
  }

  async getFullById(id: string): Promise<RequestFullRow | null> {
    const rows = await this.prisma.client.$queryRaw<RequestFullRow[]>`
      SELECT ${FULL_ROW_SELECT}
      FROM "Request" r
      WHERE r.id = ${id} AND r."deletedAt" IS NULL
    `;
    return rows[0] ?? null;
  }

  async getFullByClient(id: string, clientId: string): Promise<RequestFullRow | null> {
    const rows = await this.prisma.client.$queryRaw<RequestFullRow[]>`
      SELECT ${FULL_ROW_SELECT}
      FROM "Request" r
      WHERE r.id = ${id} AND r."clientId" = ${clientId} AND r."deletedAt" IS NULL
    `;
    return rows[0] ?? null;
  }

  // Only returns a row when the caller has a sent or accepted quote on it
  // (DATA-MODEL.md / decisions for this step): a photographer without one
  // gets exactly the same empty result as for a request that doesn't exist.
  async getSummaryForPhotographer(
    id: string,
    photographerProfileId: string,
  ): Promise<RequestSummaryRow | null> {
    const coarseLocation = Prisma.sql`ST_SetSRID(ST_SnapToGrid(r.location::geometry, ${LOCATION_GRID_DEGREES}), 4326)`;
    const rows = await this.prisma.client.$queryRaw<RequestSummaryRow[]>`
      SELECT
        r.id AS "id",
        r.title AS "title",
        r.category::text AS "category",
        r.description AS "description",
        r."eventDate" AS "eventDate",
        r."dateFlexible" AS "dateFlexible",
        r.city AS "city",
        r."countryCode" AS "countryCode",
        r."budgetMinCents" AS "budgetMinCents",
        r."budgetMaxCents" AS "budgetMaxCents",
        r.currency AS "currency",
        r.usage::text AS "usage",
        r.status::text AS "status",
        r."expiresAt" AS "expiresAt",
        ST_Y(${coarseLocation}) AS "lat",
        ST_X(${coarseLocation}) AS "lng",
        true AS "hasQuoted"
      FROM "Request" r
      WHERE r.id = ${id}
        AND r."deletedAt" IS NULL
        AND EXISTS (
          SELECT 1 FROM "Quote" q
          WHERE q."requestId" = r.id AND q."photographerId" = ${photographerProfileId}
            AND q.status IN ('sent', 'accepted')
        )
    `;
    return rows[0] ?? null;
  }

  async listMine(
    clientId: string,
    limit: number,
    cursor?: CreatedAtCursor,
  ): Promise<RequestFullRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`r."clientId" = ${clientId}`,
      Prisma.sql`r."deletedAt" IS NULL`,
    ];
    if (cursor) {
      conditions.push(
        Prisma.sql`(r."createdAt" < ${cursor.createdAt} OR (r."createdAt" = ${cursor.createdAt} AND r.id > ${cursor.id}))`,
      );
    }

    return this.prisma.client.$queryRaw<RequestFullRow[]>`
      SELECT ${FULL_ROW_SELECT}
      FROM "Request" r
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY r."createdAt" DESC, r.id ASC
      LIMIT ${limit + 1}
    `;
  }

  async feed(filters: FeedFilters): Promise<RequestFeedRow[]> {
    const coarseLocation = Prisma.sql`ST_SetSRID(ST_SnapToGrid(r.location::geometry, ${LOCATION_GRID_DEGREES}), 4326)::geography`;
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${filters.lng}, ${filters.lat}), 4326)::geography`;

    const conditions: Prisma.Sql[] = [
      Prisma.sql`r."deletedAt" IS NULL`,
      Prisma.sql`r.status IN ('open', 'quoted')`,
      Prisma.sql`r."expiresAt" > now()`,
      Prisma.sql`r.location IS NOT NULL`,
      Prisma.sql`r.category = ANY(${filters.categories}::"PhotographerCategory"[])`,
      Prisma.sql`ST_DWithin(${coarseLocation}, ${point}, ${filters.radiusKm * 1000})`,
    ];
    if (filters.cursor) {
      conditions.push(
        Prisma.sql`(r."createdAt" < ${filters.cursor.createdAt} OR (r."createdAt" = ${filters.cursor.createdAt} AND r.id > ${filters.cursor.id}))`,
      );
    }

    return this.prisma.client.$queryRaw<RequestFeedRow[]>`
      SELECT
        r.id AS "id",
        r.title AS "title",
        r.category::text AS "category",
        r.description AS "description",
        r."eventDate" AS "eventDate",
        r."dateFlexible" AS "dateFlexible",
        r.city AS "city",
        r."countryCode" AS "countryCode",
        r."budgetMinCents" AS "budgetMinCents",
        r."budgetMaxCents" AS "budgetMaxCents",
        r.currency AS "currency",
        r.usage::text AS "usage",
        r.status::text AS "status",
        r."expiresAt" AS "expiresAt",
        r."createdAt" AS "createdAt",
        ST_Y(${coarseLocation}::geometry) AS "lat",
        ST_X(${coarseLocation}::geometry) AS "lng",
        EXISTS (
          SELECT 1 FROM "Quote" q
          WHERE q."requestId" = r.id AND q."photographerId" = ${filters.photographerProfileId} AND q.status = 'sent'
        ) AS "hasQuoted"
      FROM "Request" r
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY r."createdAt" DESC, r.id ASC
      LIMIT ${filters.limit + 1}
    `;
  }
}
