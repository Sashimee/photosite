import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type PhotographerProfile,
  type PhotographerProfileUncheckedUpdateInput,
} from '@photoo/db';
import type {
  CreatePhotographerProfileRequestSchema,
  OwnPhotographerProfileSchema,
  PhotographerSearchQuerySchema,
  PhotographerSummarySchema,
  PublicPhotographerProfileSchema,
  UpdatePhotographerProfileRequestSchema,
  UploadPurpose,
} from '@photoo/shared';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
import { toPrismaCategory } from '../../common/enums/photographer-category.js';
import { isAttachableUploadStatus } from '../../common/enums/upload-status.js';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  mapOwnProfile,
  mapPublicPortfolioImage,
  mapPublicProfile,
  mapSummaryRow,
} from './profile-mapper.js';
import { ProfilesRateLimitService } from './profiles-rate-limit.service.js';
import { ProfilesRepository } from './profiles.repository.js';
import { decodeSearchCursor, encodeSearchCursor } from './search-cursor.js';
import { generateUniqueSlug } from './slug.js';

type CreateInput = z.infer<typeof CreatePhotographerProfileRequestSchema>;
type UpdateInput = z.infer<typeof UpdatePhotographerProfileRequestSchema>;
type SearchQuery = z.infer<typeof PhotographerSearchQuerySchema>;
interface SessionUser {
  id: string;
  roles: string[];
}

function notFound(message = 'Photographer profile not found'): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message }, 404);
}

const PROFILE_WITH_UPLOADS_INCLUDE = { avatarUpload: true, coverUpload: true } as const;

@Injectable()
export class ProfilesService {
  private readonly baseUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProfilesRepository) private readonly repository: ProfilesRepository,
    @Inject(ProfilesRateLimitService) private readonly rateLimit: ProfilesRateLimitService,
    @Inject(APP_CONFIG) config: Env,
  ) {
    this.baseUrl = config.S3_PUBLIC_BASE_URL;
  }

  async search(
    query: SearchQuery,
    ip: string | undefined,
  ): Promise<{ items: z.infer<typeof PhotographerSummarySchema>[]; nextCursor: string | null }> {
    await this.rateLimit.enforceSearch(ip);

    const isGeoSearch = query.lat !== undefined && query.lng !== undefined;
    const cursor = query.cursor ? decodeSearchCursor(query.cursor, isGeoSearch) : undefined;

    const rows = await this.repository.search({
      lat: query.lat,
      lng: query.lng,
      radiusKm: query.radiusKm,
      city: query.city,
      category: query.category,
      language: query.language,
      priceMinCents: query.priceMinCents,
      priceMaxCents: query.priceMaxCents,
      limit: query.limit,
      cursor,
    });

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && last ? encodeSearchCursor(isGeoSearch, last.sortValue, last.id) : null;

    return {
      items: pageRows.map((row) => mapSummaryRow(row, this.baseUrl)),
      nextCursor,
    };
  }

  async getPublicBySlug(slug: string): Promise<z.infer<typeof PublicPhotographerProfileSchema>> {
    const profile = await this.prisma.client.photographerProfile.findUnique({
      where: { slug },
      include: {
        ...PROFILE_WITH_UPLOADS_INCLUDE,
        portfolioImages: {
          where: { status: 'approved', deletedAt: null },
          orderBy: { order: 'asc' },
          include: { upload: true },
        },
      },
    });

    if (!profile || profile.deletedAt || !profile.isPublished) {
      throw notFound();
    }

    const portfolio = profile.portfolioImages.map((image) =>
      mapPublicPortfolioImage(image, image.upload, this.baseUrl),
    );
    return mapPublicProfile(profile, portfolio, this.baseUrl);
  }

  async getOwnProfileRecord(userId: string): Promise<PhotographerProfile> {
    const profile = await this.prisma.client.photographerProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw notFound();
    }
    return profile;
  }

  async getOwn(user: SessionUser): Promise<z.infer<typeof OwnPhotographerProfileSchema>> {
    requireRole(user, 'photographer');
    const profile = await this.prisma.client.photographerProfile.findUnique({
      where: { userId: user.id },
      include: PROFILE_WITH_UPLOADS_INCLUDE,
    });
    if (!profile) {
      throw notFound();
    }
    const location = await this.requireLocation(profile.id);
    return mapOwnProfile(profile, location, this.baseUrl);
  }

  async create(
    user: SessionUser,
    input: CreateInput,
  ): Promise<z.infer<typeof OwnPhotographerProfileSchema>> {
    requireRole(user, 'photographer');

    const existing = await this.prisma.client.photographerProfile.findUnique({
      where: { userId: user.id },
    });
    if (existing) {
      throw new HttpException(
        { code: 'CONFLICT', message: 'Photographer profile already exists' },
        409,
      );
    }

    await this.assertCountryEnabled(input.countryCode);
    const slug = await generateUniqueSlug(this.prisma, input.displayName);

    const created = await this.prisma.client.photographerProfile.create({
      data: {
        userId: user.id,
        slug,
        displayName: input.displayName,
        headline: input.headline ?? null,
        bio: input.bio ?? {},
        links: input.links ?? { other: [] },
        categories: input.categories.map(toPrismaCategory),
        languages: [...input.languages],
        serviceRadiusKm: input.serviceRadiusKm ?? null,
        city: input.city,
        countryCode: input.countryCode,
      },
      include: PROFILE_WITH_UPLOADS_INCLUDE,
    });

    await this.repository.setLocation(created.id, input.location.lat, input.location.lng);

    return mapOwnProfile(created, input.location, this.baseUrl);
  }

  async update(
    user: SessionUser,
    input: UpdateInput,
  ): Promise<z.infer<typeof OwnPhotographerProfileSchema>> {
    requireRole(user, 'photographer');
    const existing = await this.getOwnProfileRecord(user.id);

    if (input.countryCode !== undefined) {
      await this.assertCountryEnabled(input.countryCode);
    }

    const avatarUploadId = await this.resolveUploadChange(user.id, input.avatarUploadId, 'avatar');
    const coverUploadId = await this.resolveUploadChange(user.id, input.coverUploadId, 'cover');

    const data: PhotographerProfileUncheckedUpdateInput = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.headline !== undefined) data.headline = input.headline;
    if (input.bio !== undefined) data.bio = input.bio;
    if (input.links !== undefined) data.links = input.links;
    if (input.categories !== undefined) data.categories = input.categories.map(toPrismaCategory);
    if (input.languages !== undefined) data.languages = [...input.languages];
    if (input.serviceRadiusKm !== undefined) data.serviceRadiusKm = input.serviceRadiusKm;
    if (input.city !== undefined) data.city = input.city;
    if (input.countryCode !== undefined) data.countryCode = input.countryCode;
    if (avatarUploadId !== undefined) data.avatarUploadId = avatarUploadId;
    if (coverUploadId !== undefined) data.coverUploadId = coverUploadId;

    let updated;
    try {
      updated = await this.prisma.client.photographerProfile.update({
        where: { id: existing.id },
        data,
        include: PROFILE_WITH_UPLOADS_INCLUDE,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new HttpException(
          { code: 'CONFLICT', message: 'Upload is already used by another profile' },
          409,
        );
      }
      throw error;
    }

    if (input.location !== undefined) {
      await this.repository.setLocation(updated.id, input.location.lat, input.location.lng);
    }
    const location = input.location ?? (await this.requireLocation(updated.id));

    return mapOwnProfile(updated, location, this.baseUrl);
  }

  private async requireLocation(profileId: string): Promise<{ lat: number; lng: number }> {
    const location = await this.repository.getLocation(profileId);
    if (!location) {
      throw new Error(`profiles: profile ${profileId} is missing a location`);
    }
    return location;
  }

  private async assertCountryEnabled(countryCode: string): Promise<void> {
    const country = await this.prisma.client.country.findUnique({ where: { code: countryCode } });
    if (!country?.enabled) {
      throw new HttpException(
        { code: 'UNPROCESSABLE_ENTITY', message: 'countryCode is not an enabled country' },
        422,
      );
    }
  }

  private async resolveUploadChange(
    userId: string,
    value: string | null | undefined,
    purpose: Extract<UploadPurpose, 'avatar' | 'cover'>,
  ): Promise<string | null | undefined> {
    if (value === undefined || value === null) {
      return value;
    }
    const upload = await this.prisma.client.upload.findUnique({ where: { id: value } });
    if (upload?.ownerId !== userId) {
      throw notFound('Upload not found');
    }
    if (upload.purpose !== purpose) {
      throw new HttpException(
        { code: 'UNPROCESSABLE_ENTITY', message: `Upload purpose must be "${purpose}"` },
        422,
      );
    }
    if (!isAttachableUploadStatus(upload.status)) {
      throw new HttpException(
        { code: 'UNPROCESSABLE_ENTITY', message: 'Upload is not usable' },
        422,
      );
    }
    return value;
  }
}
