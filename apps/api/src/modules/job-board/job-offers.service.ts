import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import {
  CreateListingRequestSchema,
  type CreateJobOfferRequestSchema,
  type CursorPaginationQuerySchema,
  type JobOfferSchema,
  type JobOffersQuerySchema,
  type PublicJobOfferSchema,
  type PublicJobOfferSummarySchema,
  type UpdateJobOfferRequestSchema,
} from '@photoo/shared';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
import { toPrismaCategory } from '../../common/enums/photographer-category.js';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '../../common/pagination/created-at-cursor.js';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProfessionalsService } from '../professionals/professionals.service.js';
import { JobBoardRateLimitService } from './job-board-rate-limit.service.js';
import { JobBoardRepository, type JobOfferFullRow } from './job-board.repository.js';
import { decodePublishedAtCursor, encodePublishedAtCursor } from './job-offer-cursor.js';
import {
  mapFullJobOffer,
  mapPublicJobOffer,
  mapPublicJobOfferSummary,
} from './job-offer-mapper.js';
import { generateUniqueJobOfferSlug } from './job-offer-slug.js';

interface SessionUser {
  id: string;
  roles: string[];
}
type CreateInput = z.infer<typeof CreateJobOfferRequestSchema>;
type UpdateInput = z.infer<typeof UpdateJobOfferRequestSchema>;
type ListQuery = z.infer<typeof CursorPaginationQuerySchema>;
type PublicQuery = z.infer<typeof JobOffersQuerySchema>;
type JobOfferDto = z.infer<typeof JobOfferSchema>;
type PublicJobOfferDto = z.infer<typeof PublicJobOfferSchema>;
type PublicJobOfferSummaryDto = z.infer<typeof PublicJobOfferSummarySchema>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LISTING_EXPIRY_DAYS = 60;

function notFound(message = 'Job offer not found'): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message }, 404);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

function unprocessable(message: string): HttpException {
  return new HttpException({ code: 'UNPROCESSABLE_ENTITY', message }, 422);
}

@Injectable()
export class JobOffersService {
  private readonly baseUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JobBoardRepository) private readonly repository: JobBoardRepository,
    @Inject(ProfessionalsService) private readonly professionals: ProfessionalsService,
    @Inject(JobBoardRateLimitService) private readonly rateLimit: JobBoardRateLimitService,
    @Inject(APP_CONFIG) config: Env,
  ) {
    this.baseUrl = config.S3_PUBLIC_BASE_URL;
  }

  async create(user: SessionUser, input: CreateInput): Promise<JobOfferDto> {
    requireRole(user, 'professional');
    const professional = await this.professionals.getOwnProfileRecord(user.id);
    await this.assertCountryEnabled(input.countryCode);
    await this.rateLimit.enforceCreate(user.id);

    const slug = await generateUniqueJobOfferSlug(this.prisma, input.title);

    // One `$transaction`, not two statements: a row with a location write
    // that failed separately would 500 every reader instead of rolling back.
    const created = await this.prisma.client.$transaction(async (tx) => {
      const row = await tx.jobOffer.create({
        data: {
          professionalId: professional.id,
          slug,
          title: input.title,
          description: input.description,
          category: toPrismaCategory(input.category),
          city: input.city,
          countryCode: input.countryCode,
          remote: input.remote,
          startDate: input.startDate ? new Date(input.startDate) : null,
          endDate: input.endDate ? new Date(input.endDate) : null,
          compensation: input.compensation ?? Prisma.JsonNull,
          status: 'draft',
        },
      });

      if (input.location) {
        await this.repository.setLocation(row.id, input.location.lat, input.location.lng, tx);
      }

      return row;
    });

    return mapFullJobOffer(await this.requireOwnRow(created.id, professional.id));
  }

  async listOwn(
    user: SessionUser,
    query: ListQuery,
  ): Promise<{ items: JobOfferDto[]; nextCursor: string | null }> {
    requireRole(user, 'professional');
    const professional = await this.professionals.getOwnProfileRecord(user.id);
    const cursor = query.cursor ? decodeCreatedAtCursor(query.cursor) : undefined;
    const rows = await this.repository.listOwn(professional.id, query.limit, cursor);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCreatedAtCursor(last.createdAt, last.id) : null;

    return { items: page.map(mapFullJobOffer), nextCursor };
  }

  async getOwn(user: SessionUser, id: string): Promise<JobOfferDto> {
    requireRole(user, 'professional');
    const professional = await this.professionals.getOwnProfileRecord(user.id);
    const row = await this.repository.getOwnById(id, professional.id);
    if (!row) {
      throw notFound();
    }
    return mapFullJobOffer(row);
  }

  async update(user: SessionUser, id: string, input: UpdateInput): Promise<JobOfferDto> {
    requireRole(user, 'professional');
    const professional = await this.professionals.getOwnProfileRecord(user.id);
    const existing = await this.repository.getOwnById(id, professional.id);
    if (!existing) {
      throw notFound();
    }

    if (input.countryCode !== undefined) {
      await this.assertCountryEnabled(input.countryCode);
    }

    // UpdateJobOfferRequestSchema carries no startDate <= endDate refinement
    // (zod 4.6.5 refuses .partial() on a refined schema), so the check is
    // done here, against the merged result of the patch and the existing
    // row (docs/steps/1A.13-professionals.md).
    const nextStartDate =
      input.startDate !== undefined
        ? input.startDate === null
          ? null
          : new Date(input.startDate)
        : existing.startDate;
    const nextEndDate =
      input.endDate !== undefined
        ? input.endDate === null
          ? null
          : new Date(input.endDate)
        : existing.endDate;
    if (nextStartDate && nextEndDate && nextStartDate.getTime() > nextEndDate.getTime()) {
      throw unprocessable('startDate must be less than or equal to endDate');
    }

    // Same reasoning as the date check above: CreateJobOfferRequestSchema's
    // remote/location refinement doesn't survive .partial(), so PATCH checks
    // the merged result itself.
    const nextRemote = input.remote ?? existing.remote;
    const nextHasLocation =
      input.location !== undefined ? true : existing.lat !== null && existing.lng !== null;
    if (!nextRemote && !nextHasLocation) {
      throw unprocessable('location is required unless remote is true');
    }

    const data: Prisma.JobOfferUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.category !== undefined) data.category = toPrismaCategory(input.category);
    if (input.city !== undefined) data.city = input.city;
    if (input.countryCode !== undefined) data.countryCode = input.countryCode;
    if (input.remote !== undefined) data.remote = input.remote;
    if (input.startDate !== undefined) data.startDate = nextStartDate;
    if (input.endDate !== undefined) data.endDate = nextEndDate;
    if (input.compensation !== undefined) data.compensation = input.compensation ?? Prisma.JsonNull;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.jobOffer.update({ where: { id: existing.id }, data });
      if (input.location !== undefined) {
        await this.repository.setLocation(existing.id, input.location.lat, input.location.lng, tx);
      }
    });

    return mapFullJobOffer(await this.requireOwnRow(existing.id, professional.id));
  }

  async delete(user: SessionUser, id: string): Promise<void> {
    requireRole(user, 'professional');
    const professional = await this.professionals.getOwnProfileRecord(user.id);
    const existing = await this.repository.getOwnById(id, professional.id);
    if (!existing) {
      throw notFound();
    }
    await this.prisma.client.jobOffer.delete({ where: { id: existing.id } });
  }

  // Publishing always creates a brand new `Listing` (D8): re-publishing a
  // closed or expired offer never extends or reuses the previous one, since
  // that is the moment Phase 3 would charge for it
  // (docs/steps/1A.13-professionals.md).
  async publish(user: SessionUser, id: string): Promise<JobOfferDto> {
    requireRole(user, 'professional');
    const professional = await this.professionals.getOwnProfileRecord(user.id);

    const existing = await this.repository.getOwnById(id, professional.id);
    if (!existing) {
      throw notFound();
    }
    if (existing.status === 'published') {
      throw conflict('Job offer is already published');
    }

    // Consumed only once the offer is known to exist, be owned by the
    // caller and not already published: probing dead ids must never burn
    // the daily publish budget.
    await this.rateLimit.enforcePublish(user.id);

    const country = await this.prisma.client.country.findUnique({
      where: { code: existing.countryCode },
    });
    if (!country) {
      throw new Error(
        `job-board: job offer country "${existing.countryCode}" is missing from Country`,
      );
    }

    // Runtime guard, not just the `z.literal('free')` type (D8): a future
    // edit that widens this call site fails loudly instead of billing Phase 1.
    const listingRequest = CreateListingRequestSchema.parse({ kind: 'job_offer', plan: 'free' });

    const publishedAt = new Date();
    const expiresAt = new Date(publishedAt.getTime() + LISTING_EXPIRY_DAYS * MS_PER_DAY);

    // The `status` above is a fast pre-check, not the guard: two concurrent
    // publishes both pass it, so the update that actually flips the status
    // is a conditional `updateMany` inside the same transaction as the
    // listing insert. Whichever call loses the race rolls back its listing
    // instead of leaving an orphan with a live `expiresAt` (D8).
    await this.prisma.client.$transaction(async (tx) => {
      const listing = await tx.listing.create({
        data: {
          ownerId: existing.id,
          kind: listingRequest.kind,
          plan: listingRequest.plan,
          priceCents: 0,
          currency: country.currency,
          paidAt: publishedAt,
          expiresAt,
        },
      });

      const result = await tx.jobOffer.updateMany({
        where: { id: existing.id, status: { in: ['draft', 'closed', 'expired'] } },
        data: { status: 'published', publishedAt, expiresAt, listingId: listing.id },
      });
      if (result.count === 0) {
        throw conflict('Job offer is already published');
      }
    });

    return mapFullJobOffer(await this.requireOwnRow(existing.id, professional.id));
  }

  async close(user: SessionUser, id: string): Promise<JobOfferDto> {
    requireRole(user, 'professional');
    const professional = await this.professionals.getOwnProfileRecord(user.id);
    const existing = await this.repository.getOwnById(id, professional.id);
    if (!existing) {
      throw notFound();
    }

    const result = await this.prisma.client.jobOffer.updateMany({
      where: { id: existing.id, status: 'published' },
      data: { status: 'closed' },
    });
    if (result.count === 0) {
      throw conflict('Job offer is not open to be closed');
    }

    return mapFullJobOffer(await this.requireOwnRow(existing.id, professional.id));
  }

  async listPublic(
    query: PublicQuery,
  ): Promise<{ items: PublicJobOfferSummaryDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodePublishedAtCursor(query.cursor) : undefined;
    const rows = await this.repository.listPublic({
      category: query.category,
      countryCode: query.countryCode,
      city: query.city,
      remote: query.remote,
      q: query.q,
      limit: query.limit,
      cursor,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodePublishedAtCursor(last.publishedAt, last.id) : null;

    return { items: page.map((row) => mapPublicJobOfferSummary(row, this.baseUrl)), nextCursor };
  }

  async getPublicBySlug(slug: string): Promise<PublicJobOfferDto> {
    const row = await this.repository.getPublicBySlug(slug);
    if (!row) {
      throw notFound();
    }
    return mapPublicJobOffer(row, this.baseUrl);
  }

  private async requireOwnRow(id: string, professionalId: string): Promise<JobOfferFullRow> {
    const row = await this.repository.getOwnById(id, professionalId);
    if (!row) {
      throw new Error(`job-board: job offer ${id} disappeared right after a write`);
    }
    return row;
  }

  private async assertCountryEnabled(countryCode: string): Promise<void> {
    const country = await this.prisma.client.country.findUnique({ where: { code: countryCode } });
    if (!country?.enabled) {
      throw unprocessable('countryCode is not an enabled country');
    }
  }
}
