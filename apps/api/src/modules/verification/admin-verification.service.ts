import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import type {
  AdminVerificationCaseSchema,
  AdminVerificationCasesQuerySchema,
  AdminVerificationCaseSummarySchema,
} from '@photoo/shared';
import type { z } from 'zod';
import { AuditLogService } from '../../common/audit/audit-log.service.js';
import { PublishPolicy } from '../../common/publish/publish-policy.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  decodeVerificationCaseCursor,
  encodeVerificationCaseCursor,
} from './verification-cursor.js';
import { VerificationEncryptionService } from './verification-encryption.service.js';
import {
  isDocumentDownloadable,
  mapAdminVerificationCase,
  mapAdminVerificationCaseSummary,
  type DecryptedVerificationFields,
} from './verification-mapper.js';
import { VerificationRateLimitService } from './verification-rate-limit.service.js';
import {
  CASE_WITH_DOCUMENTS_AND_PHOTOGRAPHER_INCLUDE,
  VerificationRepository,
} from './verification.repository.js';

const DOCUMENT_URL_EXPIRY_SECONDS = 5 * 60;

interface AdminUser {
  id: string;
}

type ListQuery = z.infer<typeof AdminVerificationCasesQuerySchema>;
type CaseSummaryDto = z.infer<typeof AdminVerificationCaseSummarySchema>;
type CaseDetailDto = z.infer<typeof AdminVerificationCaseSchema>;

function notFound(): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message: 'Verification case not found' }, 404);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

function photographerIdentity(row: {
  user: { email: string; photographerProfile: { displayName: string } | null };
}) {
  return {
    displayName: row.user.photographerProfile?.displayName ?? row.user.email,
    email: row.user.email,
  };
}

@Injectable()
export class AdminVerificationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VerificationRepository) private readonly repository: VerificationRepository,
    @Inject(VerificationEncryptionService)
    private readonly encryption: VerificationEncryptionService,
    @Inject(VerificationRateLimitService) private readonly rateLimit: VerificationRateLimitService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async list(query: ListQuery): Promise<{ items: CaseSummaryDto[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeVerificationCaseCursor(query.cursor) : undefined;
    const rows = await this.repository.list({
      ...(query.status ? { status: query.status } : {}),
      ...(query.countryCode ? { countryCode: query.countryCode } : {}),
      ...(cursor ? { cursor } : {}),
      limit: query.limit,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeVerificationCaseCursor(last.submittedAt, last.id) : null;

    return {
      items: page.map((row) => mapAdminVerificationCaseSummary(row, photographerIdentity(row))),
      nextCursor,
    };
  }

  async get(admin: AdminUser, id: string, ip: string | undefined): Promise<CaseDetailDto> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw notFound();
    }

    const downloadUrls = new Map<string, string>();
    for (const document of row.documents) {
      if (!isDocumentDownloadable(document.upload)) {
        continue;
      }
      await this.rateLimit.enforceAdminDocumentUrl(admin.id);
      const url = await this.storage.presignGet({
        bucket: this.storage.config.privateBucket,
        key: document.upload.objectKey,
        expiresInSeconds: DOCUMENT_URL_EXPIRY_SECONDS,
        responseContentType: document.upload.mimeType,
        responseContentDisposition: 'attachment',
      });
      downloadUrls.set(document.id, url);
    }

    await this.auditLog.record({
      actorType: 'admin',
      actorId: admin.id,
      action: 'verification_case.documents_accessed',
      targetType: 'VerificationCase',
      targetId: row.id,
      after: { documentIds: row.documents.map((document) => document.id) },
      ip: ip ?? null,
    });

    return mapAdminVerificationCase(row, this.decryptFields(row), downloadUrls);
  }

  async startReview(admin: AdminUser, id: string, ip: string | undefined): Promise<CaseSummaryDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw notFound();
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.verificationCase.updateMany({
        where: { id, status: 'submitted' },
        data: { status: 'in_review', assignedAdminId: admin.id },
      });
      if (result.count === 0) {
        throw conflict('Verification case is not awaiting review');
      }

      await tx.auditLog.create({
        data: {
          actorType: 'admin',
          actorId: admin.id,
          action: 'verification_case.review_started',
          targetType: 'VerificationCase',
          targetId: id,
          before: { status: 'submitted' },
          after: { status: 'in_review', assignedAdminId: admin.id },
          ip: ip ?? null,
        },
      });

      return tx.verificationCase.findUniqueOrThrow({
        where: { id },
        include: CASE_WITH_DOCUMENTS_AND_PHOTOGRAPHER_INCLUDE,
      });
    });

    return mapAdminVerificationCaseSummary(updated, photographerIdentity(updated));
  }

  async approve(admin: AdminUser, id: string, ip: string | undefined): Promise<CaseSummaryDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw notFound();
    }

    let updated;
    try {
      updated = await this.prisma.client.$transaction(async (tx) => {
        const result = await tx.verificationCase.updateMany({
          where: { id, status: 'in_review' },
          data: { status: 'approved', decidedAt: new Date(), decidedByAdminId: admin.id },
        });
        if (result.count === 0) {
          throw conflict('Verification case is not in review');
        }

        await tx.photographerProfile.update({
          where: { userId: existing.userId },
          data: { verificationStatus: 'verified' },
        });

        await tx.auditLog.create({
          data: {
            actorType: 'admin',
            actorId: admin.id,
            action: 'verification_case.approved',
            targetType: 'VerificationCase',
            targetId: id,
            before: { status: 'in_review' },
            after: { status: 'approved' },
            ip: ip ?? null,
          },
        });

        return tx.verificationCase.findUniqueOrThrow({
          where: { id },
          include: CASE_WITH_DOCUMENTS_AND_PHOTOGRAPHER_INCLUDE,
        });
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw conflict('The photographer profile no longer exists');
      }
      throw error;
    }

    await this.notifications.notify(existing.userId, 'verification_approved', {});

    return mapAdminVerificationCaseSummary(updated, photographerIdentity(updated));
  }

  async reject(
    admin: AdminUser,
    id: string,
    reason: string,
    ip: string | undefined,
  ): Promise<CaseSummaryDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw notFound();
    }

    let updated;
    try {
      updated = await this.prisma.client.$transaction(async (tx) => {
        const result = await tx.verificationCase.updateMany({
          where: { id, status: 'in_review' },
          data: {
            status: 'rejected',
            decidedAt: new Date(),
            decidedByAdminId: admin.id,
            rejectionReason: reason,
          },
        });
        if (result.count === 0) {
          throw conflict('Verification case is not in review');
        }

        const profile = await tx.photographerProfile.update({
          where: { userId: existing.userId },
          data: { verificationStatus: 'rejected' },
        });
        if (profile.isPublished && !PublishPolicy.canPublish(profile)) {
          await tx.photographerProfile.update({
            where: { id: profile.id },
            data: { isPublished: false },
          });
        }

        await tx.auditLog.create({
          data: {
            actorType: 'admin',
            actorId: admin.id,
            action: 'verification_case.rejected',
            targetType: 'VerificationCase',
            targetId: id,
            before: { status: 'in_review' },
            after: { status: 'rejected' },
            ip: ip ?? null,
          },
        });

        return tx.verificationCase.findUniqueOrThrow({
          where: { id },
          include: CASE_WITH_DOCUMENTS_AND_PHOTOGRAPHER_INCLUDE,
        });
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        throw conflict('The photographer profile no longer exists');
      }
      throw error;
    }

    await this.notifications.notify(existing.userId, 'verification_rejected', { reason });

    return mapAdminVerificationCaseSummary(updated, photographerIdentity(updated));
  }

  private decryptFields(row: {
    businessName: string | null;
    vatNumber: string | null;
    businessRegistrationNumber: string | null;
  }): DecryptedVerificationFields {
    return {
      businessName: this.encryption.decrypt(row.businessName),
      vatNumber: this.encryption.decrypt(row.vatNumber),
      businessRegistrationNumber: this.encryption.decrypt(row.businessRegistrationNumber),
    };
  }
}
