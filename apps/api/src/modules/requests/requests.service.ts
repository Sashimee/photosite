import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PhotographerProfile } from '@photoo/db';
import type {
  CreateRequestRequestSchema,
  CursorPaginationQuerySchema,
  RequestFeedQuerySchema,
  RequestSchema,
  RequestSummarySchema,
} from '@photoo/shared';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
import { toPrismaCategory, toWireCategory } from '../../common/enums/photographer-category.js';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '../../common/pagination/created-at-cursor.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ProfilesRepository } from '../profiles/profiles.repository.js';
import { mapFullRequest, mapRequestSummary } from './request-mapper.js';
import { RequestsRateLimitService } from './requests-rate-limit.service.js';
import { RequestsRepository } from './requests.repository.js';

interface SessionUser {
  id: string;
  roles: string[];
}
type CreateInput = z.infer<typeof CreateRequestRequestSchema>;
type FeedQuery = z.infer<typeof RequestFeedQuerySchema>;
type MineQuery = z.infer<typeof CursorPaginationQuerySchema>;
type RequestDto = z.infer<typeof RequestSchema>;
type RequestSummaryDto = z.infer<typeof RequestSummarySchema>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const REQUEST_EXPIRY_DAYS = 60;

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Request not found' }, 404);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

function unprocessable(message: string): HttpException {
  return new HttpException({ code: 'UNPROCESSABLE_ENTITY', message }, 422);
}

function photographerProfileRequired(): HttpException {
  return new HttpException(
    { code: 'FORBIDDEN', message: 'A published photographer profile is required' },
    403,
  );
}

@Injectable()
export class RequestsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RequestsRepository) private readonly repository: RequestsRepository,
    @Inject(ProfilesRepository) private readonly profilesRepository: ProfilesRepository,
    @Inject(RequestsRateLimitService) private readonly rateLimit: RequestsRateLimitService,
  ) {}

  async create(user: SessionUser, input: CreateInput, ip: string | undefined): Promise<RequestDto> {
    await this.rateLimit.enforceCreate(ip, user.id);

    const country = await this.prisma.client.country.findUnique({
      where: { code: input.address.countryCode },
    });
    if (!country?.enabled) {
      throw unprocessable('countryCode is not an enabled country');
    }
    if (input.budgetMin.currency !== country.currency) {
      throw unprocessable("budget currency must match the address country's currency");
    }

    const eventDate = new Date(input.eventDate);
    const maxExpiry = new Date(Date.now() + REQUEST_EXPIRY_DAYS * MS_PER_DAY);
    const expiresAt = eventDate.getTime() < maxExpiry.getTime() ? eventDate : maxExpiry;

    const created = await this.prisma.client.$transaction(async (tx) => {
      const request = await tx.request.create({
        data: {
          clientId: user.id,
          title: input.title,
          category: toPrismaCategory(input.category),
          description: input.description,
          eventDate,
          dateFlexible: input.dateFlexible,
          address: input.address,
          city: input.address.city,
          countryCode: input.address.countryCode,
          budgetMinCents: input.budgetMin.amountCents,
          budgetMaxCents: input.budgetMax.amountCents,
          currency: input.budgetMin.currency,
          usage: input.usage,
          status: 'open',
          expiresAt,
        },
      });
      await this.repository.setLocation(request.id, input.location.lat, input.location.lng, tx);
      return request;
    });

    const full = await this.repository.getFullById(created.id);
    if (!full) {
      throw new Error(`requests: request ${created.id} disappeared right after creation`);
    }
    return mapFullRequest(full);
  }

  async mine(
    user: SessionUser,
    query: MineQuery,
  ): Promise<{ items: RequestDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeCreatedAtCursor(query.cursor) : undefined;
    const rows = await this.repository.listMine(user.id, query.limit, cursor);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCreatedAtCursor(last.createdAt, last.id) : null;

    return { items: page.map(mapFullRequest), nextCursor };
  }

  async get(user: SessionUser, id: string): Promise<RequestDto | RequestSummaryDto> {
    const own = await this.repository.getFullByClient(id, user.id);
    if (own) {
      return mapFullRequest(own);
    }

    const profile = await this.findCallerProfile(user.id);
    if (profile) {
      const summary = await this.repository.getSummaryForPhotographer(id, profile.id);
      if (summary) {
        return mapRequestSummary(summary);
      }
    }

    throw notFound();
  }

  async cancel(user: SessionUser, id: string): Promise<RequestDto> {
    const existing = await this.repository.getFullByClient(id, user.id);
    if (!existing) {
      throw notFound();
    }

    await this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.request.updateMany({
        where: { id, status: { in: ['open', 'quoted'] } },
        data: { status: 'cancelled' },
      });
      if (updated.count === 0) {
        throw conflict('Request is not open for cancellation');
      }

      const sentQuotes = await tx.quote.findMany({
        where: { requestId: id, status: 'sent' },
        select: { id: true },
      });
      const declinedQuoteIds = sentQuotes.map((quote) => quote.id);
      if (declinedQuoteIds.length > 0) {
        await tx.quote.updateMany({
          where: { id: { in: declinedQuoteIds } },
          data: { status: 'declined' },
        });
      }

      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          action: 'request.cancelled',
          targetType: 'Request',
          targetId: id,
          before: { status: existing.status },
          after: { status: 'cancelled', declinedQuoteIds },
        },
      });
    });

    const cancelled = await this.repository.getFullById(id);
    if (!cancelled) {
      throw new Error(`requests: request ${id} disappeared right after cancellation`);
    }
    return mapFullRequest(cancelled);
  }

  async feed(
    user: SessionUser,
    query: FeedQuery,
  ): Promise<{ items: RequestSummaryDto[]; nextCursor: string | null }> {
    requireRole(user, 'photographer');
    const profile = await this.findCallerProfile(user.id);
    if (!profile?.isPublished) {
      throw photographerProfileRequired();
    }

    const location = await this.profilesRepository.getLocation(profile.id);
    if (!location || !Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
      throw new Error(`requests: photographer profile ${profile.id} is missing a location`);
    }

    const cursor = query.cursor ? decodeCreatedAtCursor(query.cursor) : undefined;
    const rows = await this.repository.feed({
      lat: location.lat,
      lng: location.lng,
      radiusKm: query.radiusKm,
      categories: profile.categories.map(toWireCategory),
      photographerProfileId: profile.id,
      limit: query.limit,
      cursor,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCreatedAtCursor(last.createdAt, last.id) : null;

    return { items: page.map(mapRequestSummary), nextCursor };
  }

  private async findCallerProfile(userId: string): Promise<PhotographerProfile | null> {
    const profile = await this.prisma.client.photographerProfile.findUnique({
      where: { userId },
    });
    return profile && !profile.deletedAt ? profile : null;
  }
}
