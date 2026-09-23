import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type JobApplication } from '@photoo/db';
import {
  truncateNotificationText,
  type CreateJobApplicationRequestSchema,
  type CursorPaginationQuerySchema,
  type JobApplicationSchema,
  type JobApplicationWithOfferSchema,
  type JobApplicationWithPhotographerSchema,
  type UpdateJobApplicationStatusRequestSchema,
} from '@photoo/shared';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '../../common/pagination/created-at-cursor.js';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { JobBoardRateLimitService } from './job-board-rate-limit.service.js';
import {
  mapJobApplication,
  mapJobApplicationWithOffer,
  mapJobApplicationWithPhotographer,
} from './job-application-mapper.js';

interface SessionUser {
  id: string;
  roles: string[];
}
type ApplyInput = z.infer<typeof CreateJobApplicationRequestSchema>;
type StatusInput = z.infer<typeof UpdateJobApplicationStatusRequestSchema>;
type ListQuery = z.infer<typeof CursorPaginationQuerySchema>;
type ApplicationDto = z.infer<typeof JobApplicationSchema>;
type ApplicationWithPhotographerDto = z.infer<typeof JobApplicationWithPhotographerSchema>;
type ApplicationWithOfferDto = z.infer<typeof JobApplicationWithOfferSchema>;

function notFound(message = 'Job application not found'): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message }, 404);
}

function jobOfferNotFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Job offer not found' }, 404);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

function forbidden(message: string): HttpException {
  return new HttpException({ code: 'FORBIDDEN', message }, 403);
}

function unprocessable(message: string): HttpException {
  return new HttpException({ code: 'UNPROCESSABLE_ENTITY', message }, 422);
}

@Injectable()
export class JobApplicationsService {
  private readonly baseUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JobBoardRateLimitService) private readonly rateLimit: JobBoardRateLimitService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) config: Env,
  ) {
    this.baseUrl = config.S3_PUBLIC_BASE_URL;
  }

  async apply(user: SessionUser, jobOfferId: string, input: ApplyInput): Promise<ApplicationDto> {
    requireRole(user, 'photographer');
    const profile = await this.requirePhotographerProfile(user.id);
    await this.rateLimit.enforceApply(profile.id);

    const offer = await this.prisma.client.jobOffer.findUnique({ where: { id: jobOfferId } });
    if (!offer) {
      throw jobOfferNotFound();
    }
    if (
      offer.status !== 'published' ||
      !offer.expiresAt ||
      offer.expiresAt.getTime() <= Date.now()
    ) {
      throw conflict('Job offer is not open for applications');
    }

    const professional = await this.prisma.client.professionalProfile.findUnique({
      where: { id: offer.professionalId },
    });
    if (professional?.userId === user.id) {
      throw unprocessable('Cannot apply to your own job offer');
    }

    let created: JobApplication;
    try {
      created = await this.prisma.client.jobApplication.create({
        data: {
          jobOfferId: offer.id,
          photographerId: profile.id,
          message: input.message,
          portfolioLink: input.portfolioLink ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('You have already applied to this job offer');
      }
      throw error;
    }

    if (professional) {
      await this.notifications.notify(professional.userId, 'job_application_received', {
        jobOfferId: offer.id,
        jobOfferTitle: truncateNotificationText(offer.title),
        jobApplicationId: created.id,
        counterpartName: truncateNotificationText(profile.displayName),
      });
    }

    return mapJobApplication(created);
  }

  async listReceived(
    user: SessionUser,
    jobOfferId: string,
    query: ListQuery,
  ): Promise<{ items: ApplicationWithPhotographerDto[]; nextCursor: string | null }> {
    requireRole(user, 'professional');
    const professional = await this.prisma.client.professionalProfile.findUnique({
      where: { userId: user.id },
    });
    const offer = professional
      ? await this.prisma.client.jobOffer.findUnique({ where: { id: jobOfferId } })
      : null;
    if (!offer || offer.professionalId !== professional?.id) {
      throw jobOfferNotFound();
    }

    const cursor = query.cursor ? decodeCreatedAtCursor(query.cursor) : undefined;
    const rows = await this.prisma.client.jobApplication.findMany({
      where: {
        jobOfferId: offer.id,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
      include: { photographer: { include: { avatarUpload: true } } },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCreatedAtCursor(last.createdAt, last.id) : null;

    return {
      items: page.map((row) =>
        mapJobApplicationWithPhotographer(row, row.photographer, this.baseUrl),
      ),
      nextCursor,
    };
  }

  async listMine(
    user: SessionUser,
    query: ListQuery,
  ): Promise<{ items: ApplicationWithOfferDto[]; nextCursor: string | null }> {
    requireRole(user, 'photographer');
    const profile = await this.prisma.client.photographerProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      return { items: [], nextCursor: null };
    }

    const cursor = query.cursor ? decodeCreatedAtCursor(query.cursor) : undefined;
    const rows = await this.prisma.client.jobApplication.findMany({
      where: {
        photographerId: profile.id,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
      include: { jobOffer: true },
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCreatedAtCursor(last.createdAt, last.id) : null;

    return {
      items: page.map((row) => mapJobApplicationWithOffer(row, row.jobOffer)),
      nextCursor,
    };
  }

  // Every transition originates from `submitted` (like `Quote.status: 'sent'
  // -> accepted/declined`): the applicant may only withdraw and the
  // professional may only shortlist or reject
  // (docs/steps/1A.13-professionals.md).
  async updateStatus(user: SessionUser, id: string, input: StatusInput): Promise<ApplicationDto> {
    const application = await this.prisma.client.jobApplication.findUnique({ where: { id } });
    if (!application) {
      throw notFound();
    }

    const photographerProfile = await this.prisma.client.photographerProfile.findUnique({
      where: { id: application.photographerId },
    });
    const jobOffer = await this.prisma.client.jobOffer.findUnique({
      where: { id: application.jobOfferId },
    });
    const professionalProfile = jobOffer
      ? await this.prisma.client.professionalProfile.findUnique({
          where: { id: jobOffer.professionalId },
        })
      : null;

    const isApplicant = photographerProfile?.userId === user.id;
    const isOwner = professionalProfile?.userId === user.id;
    if (!isApplicant && !isOwner) {
      throw notFound();
    }

    if (isApplicant && input.status !== 'withdrawn') {
      throw forbidden('A photographer may only withdraw their own application');
    }
    if (isOwner && input.status === 'withdrawn') {
      throw forbidden('A professional may only shortlist or reject an application');
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.jobApplication.updateMany({
        where: { id, status: 'submitted' },
        data: { status: input.status },
      });
      if (result.count === 0) {
        throw conflict('Application is not open for a status change');
      }
      return tx.jobApplication.findUniqueOrThrow({ where: { id } });
    });

    if (isOwner && jobOffer && photographerProfile) {
      await this.notifications.notify(
        photographerProfile.userId,
        'job_application_status_changed',
        {
          jobOfferId: jobOffer.id,
          jobOfferTitle: truncateNotificationText(jobOffer.title),
          jobApplicationId: updated.id,
          counterpartName: truncateNotificationText(professionalProfile.companyName),
        },
      );
    }

    return mapJobApplication(updated);
  }

  private async requirePhotographerProfile(userId: string) {
    const profile = await this.prisma.client.photographerProfile.findUnique({
      where: { userId },
    });
    if (!profile || profile.deletedAt) {
      throw forbidden('A photographer profile is required to apply');
    }
    return profile;
  }
}
