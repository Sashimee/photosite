import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import {
  RequiredDocumentSchema,
  VerificationDocumentSchema,
  type AttachVerificationDocumentRequestSchema,
  type CreateVerificationCaseRequestSchema,
  type UpdateVerificationCaseRequestSchema,
  type VerificationCaseSchema,
} from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { mapVerificationCase, type DecryptedVerificationFields } from './verification-mapper.js';
import { VerificationEncryptionService } from './verification-encryption.service.js';
import { VerificationRateLimitService } from './verification-rate-limit.service.js';
import { CASE_WITH_DOCUMENTS_INCLUDE, VerificationRepository } from './verification.repository.js';

type CreateInput = z.infer<typeof CreateVerificationCaseRequestSchema>;
type UpdateInput = z.infer<typeof UpdateVerificationCaseRequestSchema>;
type AttachInput = z.infer<typeof AttachVerificationDocumentRequestSchema>;
type CaseDto = z.infer<typeof VerificationCaseSchema>;
type DocumentDto = z.infer<typeof VerificationDocumentSchema>;

interface SessionUser {
  id: string;
  roles: string[];
}

function notFound(message = 'Verification case not found'): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message }, 404);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

function unprocessable(message: string): HttpException {
  return new HttpException({ code: 'UNPROCESSABLE_ENTITY', message }, 422);
}

function forbidden(message: string): HttpException {
  return new HttpException({ code: 'FORBIDDEN', message }, 403);
}

@Injectable()
export class VerificationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VerificationRepository) private readonly repository: VerificationRepository,
    @Inject(VerificationEncryptionService)
    private readonly encryption: VerificationEncryptionService,
    @Inject(VerificationRateLimitService) private readonly rateLimit: VerificationRateLimitService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  async getOwn(user: SessionUser): Promise<CaseDto> {
    requireRole(user, 'photographer');
    const row = await this.repository.findLatestCase(user.id);
    if (!row) {
      throw notFound();
    }
    return mapVerificationCase(row, this.decryptFields(row));
  }

  async create(user: SessionUser, input: CreateInput): Promise<CaseDto> {
    requireRole(user, 'photographer');

    const profile = await this.prisma.client.photographerProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      throw forbidden('A photographer profile is required before starting verification');
    }
    const country = await this.prisma.client.country.findUnique({
      where: { code: profile.countryCode },
    });
    if (!country?.enabled) {
      throw unprocessable('Verification is not available for this country');
    }
    const activeCase = await this.repository.findOwnCase(user.id);
    if (activeCase) {
      throw conflict('An active verification case already exists');
    }

    await this.rateLimit.enforceCreate(user.id);

    const created = await this.prisma.client.$transaction(async (tx) => {
      let row;
      try {
        row = await tx.verificationCase.create({
          data: {
            userId: user.id,
            countryCode: profile.countryCode,
            status: 'draft',
            businessName: this.encryption.encrypt(input.businessName ?? null),
            vatNumber: this.encryption.encrypt(input.vatNumber ?? null),
            businessRegistrationNumber: this.encryption.encrypt(
              input.businessRegistrationNumber ?? null,
            ),
          },
          include: CASE_WITH_DOCUMENTS_INCLUDE,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw conflict('An active verification case already exists');
        }
        throw error;
      }

      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          action: 'verification_case.created',
          targetType: 'VerificationCase',
          targetId: row.id,
          after: { status: row.status, countryCode: row.countryCode },
        },
      });

      return row;
    });

    return mapVerificationCase(created, this.decryptFields(created));
  }

  async update(user: SessionUser, input: UpdateInput): Promise<CaseDto> {
    requireRole(user, 'photographer');
    const existing = await this.repository.findOwnCase(user.id);
    if (!existing) {
      throw notFound();
    }
    if (existing.status !== 'draft') {
      throw conflict('Verification case is no longer editable');
    }

    await this.rateLimit.enforceUpdate(user.id);

    const data: Prisma.VerificationCaseUncheckedUpdateInput = { updatedAt: new Date() };
    if (input.businessName !== undefined) {
      data.businessName = this.encryption.encrypt(input.businessName);
    }
    if (input.vatNumber !== undefined) {
      data.vatNumber = this.encryption.encrypt(input.vatNumber);
    }
    if (input.businessRegistrationNumber !== undefined) {
      data.businessRegistrationNumber = this.encryption.encrypt(input.businessRegistrationNumber);
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const guarded = await tx.verificationCase.updateMany({
        where: { id: existing.id, status: 'draft' },
        data,
      });
      if (guarded.count === 0) {
        throw conflict('Verification case is no longer editable');
      }

      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          action: 'verification_case.updated',
          targetType: 'VerificationCase',
          targetId: existing.id,
          after: { fields: Object.keys(data) },
        },
      });

      return tx.verificationCase.findUniqueOrThrow({
        where: { id: existing.id },
        include: CASE_WITH_DOCUMENTS_INCLUDE,
      });
    });

    return mapVerificationCase(updated, this.decryptFields(updated));
  }

  async attachDocument(user: SessionUser, input: AttachInput): Promise<DocumentDto> {
    requireRole(user, 'photographer');
    const existing = await this.repository.findOwnCase(user.id);
    if (!existing) {
      throw notFound();
    }
    if (existing.status !== 'draft') {
      throw conflict('Documents can only be attached to a draft case');
    }

    const requirement = await this.requireDocumentRequirement(
      existing.countryCode,
      input.documentKey,
    );

    const upload = await this.prisma.client.upload.findUnique({ where: { id: input.uploadId } });
    if (upload?.ownerId !== user.id || upload.purpose !== 'verification_document') {
      throw unprocessable('uploadId is not a usable verification document upload');
    }
    if (!requirement.acceptedMimeTypes.includes(upload.mimeType)) {
      throw unprocessable('uploadId has a mime type that is not accepted for this document');
    }
    if (upload.virusScanStatus !== 'clean') {
      throw unprocessable('uploadId has not been scanned clean yet');
    }

    await this.rateLimit.enforceAttachDocument(user.id);

    let document;
    let replacedUpload: { id: string; objectKey: string } | null;
    try {
      ({ document, replacedUpload } = await this.prisma.client.$transaction(async (tx) => {
        const guarded = await tx.verificationCase.updateMany({
          where: { id: existing.id, status: 'draft' },
          data: { updatedAt: new Date() },
        });
        if (guarded.count === 0) {
          throw conflict('Documents can only be attached to a draft case');
        }

        const previous = await tx.verificationDocument.findFirst({
          where: { caseId: existing.id, documentKey: input.documentKey },
          include: { upload: { select: { id: true, objectKey: true } } },
        });
        if (previous) {
          await tx.verificationDocument.delete({ where: { id: previous.id } });
          await tx.upload.update({
            where: { id: previous.uploadId },
            data: { status: 'failed', expiresAt: new Date() },
          });
        }

        const created = await tx.verificationDocument.create({
          data: { caseId: existing.id, documentKey: input.documentKey, uploadId: upload.id },
          include: { upload: true },
        });
        await tx.auditLog.create({
          data: {
            actorType: 'user',
            actorId: user.id,
            action: 'verification_case.document_attached',
            targetType: 'VerificationCase',
            targetId: existing.id,
            after: { documentKey: input.documentKey, uploadId: upload.id },
          },
        });
        return { document: created, replacedUpload: previous?.upload ?? null };
      }));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw unprocessable('uploadId is already attached to a verification case');
      }
      throw error;
    }

    // Deleted only after the transaction commits (#116, compliance): a
    // failed transaction must never delete a file a still-valid document
    // row points to.
    if (replacedUpload) {
      try {
        await this.storage.deleteObject(
          this.storage.config.privateBucket,
          replacedUpload.objectKey,
        );
      } catch (error) {
        this.logger.warn(
          { err: error, uploadId: replacedUpload.id },
          'verification: failed to delete the replaced document object, leaving it for manual cleanup',
        );
      }
    }

    return VerificationDocumentSchema.parse({
      id: document.id,
      documentKey: document.documentKey,
      mimeType: document.upload.mimeType,
      virusScanStatus: document.upload.virusScanStatus,
      uploadedAt: document.createdAt.toISOString(),
    });
  }

  async submit(user: SessionUser): Promise<CaseDto> {
    requireRole(user, 'photographer');

    const existing = await this.repository.findOwnCase(user.id);
    if (!existing) {
      throw notFound();
    }
    if (existing.status !== 'draft') {
      throw conflict('Verification case is not a draft');
    }

    const businessName = this.encryption.decrypt(existing.businessName);
    if (!businessName) {
      throw unprocessable('businessName is required before submitting');
    }

    const country = await this.prisma.client.country.findUniqueOrThrow({
      where: { code: existing.countryCode },
    });
    const requiredDocuments = RequiredDocumentSchema.array().parse(country.requiredDocuments);
    for (const requirement of requiredDocuments) {
      const document = existing.documents.find((doc) => doc.documentKey === requirement.key);
      if (document?.upload.virusScanStatus !== 'clean') {
        throw unprocessable(`Document "${requirement.key}" is missing or not yet scanned clean`);
      }
    }

    await this.rateLimit.enforceSubmit(user.id);

    let submitted;
    try {
      submitted = await this.prisma.client.$transaction(async (tx) => {
        const result = await tx.verificationCase.updateMany({
          where: { id: existing.id, status: 'draft' },
          data: { status: 'submitted', submittedAt: new Date() },
        });
        if (result.count === 0) {
          throw conflict('Verification case is not a draft');
        }

        await tx.photographerProfile.update({
          where: { userId: user.id },
          data: { verificationStatus: 'pending' },
        });

        await tx.auditLog.create({
          data: {
            actorType: 'user',
            actorId: user.id,
            action: 'verification_case.submitted',
            targetType: 'VerificationCase',
            targetId: existing.id,
            before: { status: 'draft' },
            after: { status: 'submitted' },
          },
        });

        return tx.verificationCase.findUniqueOrThrow({
          where: { id: existing.id },
          include: CASE_WITH_DOCUMENTS_INCLUDE,
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw conflict('The photographer profile no longer exists');
      }
      throw error;
    }

    return mapVerificationCase(submitted, this.decryptFields(submitted));
  }

  private async requireDocumentRequirement(countryCode: string, documentKey: string) {
    const country = await this.prisma.client.country.findUniqueOrThrow({
      where: { code: countryCode },
    });
    const requiredDocuments = RequiredDocumentSchema.array().parse(country.requiredDocuments);
    const requirement = requiredDocuments.find((doc) => doc.key === documentKey);
    if (!requirement) {
      throw unprocessable('documentKey is not required for this country');
    }
    return requirement;
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
