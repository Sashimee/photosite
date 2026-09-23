import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@photoo/db';
import type { PhotographerCategory } from '@photoo/shared';
import type { CreatedAtCursor } from '../../common/pagination/created-at-cursor.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { PublishedAtCursor } from './job-offer-cursor.js';

interface ExecuteRawClient {
  $executeRaw: PrismaClient['$executeRaw'];
}

export interface JobOfferFullRow {
  id: string;
  professionalId: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  city: string;
  countryCode: string;
  remote: boolean;
  startDate: Date | null;
  endDate: Date | null;
  compensation: unknown;
  status: string;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  lat: number;
  lng: number;
}

export interface PublicJobOfferRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  city: string;
  countryCode: string;
  remote: boolean;
  startDate: Date | null;
  endDate: Date | null;
  compensation: unknown;
  publishedAt: Date;
  expiresAt: Date;
  lat: number;
  lng: number;
  companyId: string;
  companyName: string;
  companyWebsite: string | null;
  companyLogoVariants: Record<string, string> | null;
  companyVerified: boolean;
}

export interface PublicListFilters {
  category?: PhotographerCategory | undefined;
  countryCode?: string | undefined;
  city?: string | undefined;
  remote?: boolean | undefined;
  q?: string | undefined;
  limit: number;
  cursor?: PublishedAtCursor | undefined;
}

const FULL_ROW_SELECT = Prisma.sql`
  jo.id AS "id",
  jo."professionalId" AS "professionalId",
  jo.slug AS "slug",
  jo.title AS "title",
  jo.description AS "description",
  jo.category::text AS "category",
  jo.city AS "city",
  jo."countryCode" AS "countryCode",
  jo.remote AS "remote",
  jo."startDate" AS "startDate",
  jo."endDate" AS "endDate",
  jo.compensation AS "compensation",
  jo.status::text AS "status",
  jo."publishedAt" AS "publishedAt",
  jo."expiresAt" AS "expiresAt",
  jo."createdAt" AS "createdAt",
  ST_Y(jo.location::geometry) AS "lat",
  ST_X(jo.location::geometry) AS "lng"
`;

const PUBLIC_ROW_SELECT = Prisma.sql`
  jo.id AS "id",
  jo.slug AS "slug",
  jo.title AS "title",
  jo.description AS "description",
  jo.category::text AS "category",
  jo.city AS "city",
  jo."countryCode" AS "countryCode",
  jo.remote AS "remote",
  jo."startDate" AS "startDate",
  jo."endDate" AS "endDate",
  jo.compensation AS "compensation",
  jo."publishedAt" AS "publishedAt",
  jo."expiresAt" AS "expiresAt",
  ST_Y(jo.location::geometry) AS "lat",
  ST_X(jo.location::geometry) AS "lng",
  pp.id AS "companyId",
  pp."companyName" AS "companyName",
  pp.website AS "companyWebsite",
  u.variants AS "companyLogoVariants",
  pp.verified AS "companyVerified"
`;

const PUBLIC_ROW_FROM = Prisma.sql`
  FROM "JobOffer" jo
  JOIN "ProfessionalProfile" pp ON pp.id = jo."professionalId"
  LEFT JOIN "Upload" u ON u.id = pp."logoUploadId"
`;

@Injectable()
export class JobBoardRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async setLocation(
    jobOfferId: string,
    lat: number,
    lng: number,
    client: ExecuteRawClient = this.prisma.client,
  ): Promise<void> {
    await client.$executeRaw`
      UPDATE "JobOffer"
      SET location = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
      WHERE id = ${jobOfferId}
    `;
  }

  async getOwnById(id: string, professionalId: string): Promise<JobOfferFullRow | null> {
    const rows = await this.prisma.client.$queryRaw<JobOfferFullRow[]>`
      SELECT ${FULL_ROW_SELECT}
      FROM "JobOffer" jo
      WHERE jo.id = ${id} AND jo."professionalId" = ${professionalId}
    `;
    return rows[0] ?? null;
  }

  async listOwn(
    professionalId: string,
    limit: number,
    cursor?: CreatedAtCursor,
  ): Promise<JobOfferFullRow[]> {
    const conditions: Prisma.Sql[] = [Prisma.sql`jo."professionalId" = ${professionalId}`];
    if (cursor) {
      conditions.push(
        Prisma.sql`(jo."createdAt" < ${cursor.createdAt} OR (jo."createdAt" = ${cursor.createdAt} AND jo.id > ${cursor.id}))`,
      );
    }

    return this.prisma.client.$queryRaw<JobOfferFullRow[]>`
      SELECT ${FULL_ROW_SELECT}
      FROM "JobOffer" jo
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY jo."createdAt" DESC, jo.id ASC
      LIMIT ${limit + 1}
    `;
  }

  async getPublicBySlug(slug: string): Promise<PublicJobOfferRow | null> {
    const rows = await this.prisma.client.$queryRaw<PublicJobOfferRow[]>`
      SELECT ${PUBLIC_ROW_SELECT}
      ${PUBLIC_ROW_FROM}
      WHERE jo.slug = ${slug} AND jo.status = 'published' AND jo."expiresAt" > now()
    `;
    return rows[0] ?? null;
  }

  // Every filter is bound as a query parameter through `Prisma.sql`/tagged
  // templates, including the free-text `q` match and the decoded cursor. A
  // `remote` offer matches any `city`/`countryCode` filter regardless of its
  // own location (docs/steps/1A.13-professionals.md "remote: true offers
  // match every location filter"); the `remote` query param itself is a
  // separate, exact-match filter applied on top.
  async listPublic(filters: PublicListFilters): Promise<PublicJobOfferRow[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`jo.status = 'published'`,
      Prisma.sql`jo."expiresAt" > now()`,
    ];

    if (filters.category !== undefined) {
      conditions.push(Prisma.sql`jo.category = ${filters.category}::"PhotographerCategory"`);
    }
    if (filters.countryCode !== undefined) {
      conditions.push(Prisma.sql`(jo."countryCode" = ${filters.countryCode} OR jo.remote = true)`);
    }
    if (filters.city !== undefined) {
      conditions.push(Prisma.sql`(lower(jo.city) = lower(${filters.city}) OR jo.remote = true)`);
    }
    if (filters.remote !== undefined) {
      conditions.push(Prisma.sql`jo.remote = ${filters.remote}`);
    }
    if (filters.q !== undefined) {
      conditions.push(Prisma.sql`jo.title ILIKE ${`%${filters.q}%`}`);
    }
    if (filters.cursor) {
      conditions.push(
        Prisma.sql`(jo."publishedAt" < ${filters.cursor.publishedAt} OR (jo."publishedAt" = ${filters.cursor.publishedAt} AND jo.id > ${filters.cursor.id}))`,
      );
    }

    return this.prisma.client.$queryRaw<PublicJobOfferRow[]>`
      SELECT ${PUBLIC_ROW_SELECT}
      ${PUBLIC_ROW_FROM}
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY jo."publishedAt" DESC, jo.id ASC
      LIMIT ${filters.limit + 1}
    `;
  }
}
