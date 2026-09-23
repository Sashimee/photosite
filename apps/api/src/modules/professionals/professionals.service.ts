import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type ProfessionalProfile } from '@photoo/db';
import type {
  CreateProfessionalProfileRequestSchema,
  OwnProfessionalProfileSchema,
  UpdateProfessionalProfileRequestSchema,
} from '@photoo/shared';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
import { isAttachableUploadStatus } from '../../common/enums/upload-status.js';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { mapOwnProfile, type ProfessionalProfileWithLogo } from './professional-mapper.js';

interface SessionUser {
  id: string;
  roles: string[];
}
type CreateInput = z.infer<typeof CreateProfessionalProfileRequestSchema>;
type UpdateInput = z.infer<typeof UpdateProfessionalProfileRequestSchema>;
type ProfileDto = z.infer<typeof OwnProfessionalProfileSchema>;

function notFound(message = 'Professional profile not found'): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message }, 404);
}

function uploadConflict(): HttpException {
  return new HttpException(
    { code: 'CONFLICT', message: 'Upload is already used by another profile' },
    409,
  );
}

const PROFILE_WITH_LOGO_INCLUDE = { logoUpload: true } as const;

@Injectable()
export class ProfessionalsService {
  private readonly baseUrl: string;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: Env,
  ) {
    this.baseUrl = config.S3_PUBLIC_BASE_URL;
  }

  // Creates the profile and, when the account doesn't already carry it,
  // adds the `professional` role in the same transaction (D13: one account,
  // more roles, never a second account).
  async create(user: SessionUser, input: CreateInput, ip: string | undefined): Promise<ProfileDto> {
    const existing = await this.prisma.client.professionalProfile.findUnique({
      where: { userId: user.id },
    });
    if (existing) {
      throw new HttpException(
        { code: 'CONFLICT', message: 'Professional profile already exists' },
        409,
      );
    }

    const logoUploadId = await this.resolveUploadChange(user.id, input.logoUploadId);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const profile = await tx.professionalProfile.create({
        data: {
          userId: user.id,
          companyName: input.companyName,
          website: input.website ?? null,
          vatNumber: input.vatNumber ?? null,
          logoUploadId: logoUploadId ?? null,
        },
        include: PROFILE_WITH_LOGO_INCLUDE,
      });

      if (!user.roles.includes('professional')) {
        const nextRoles = [...user.roles, 'professional'];
        await tx.user.update({
          where: { id: user.id },
          data: { roles: { set: nextRoles as never } },
        });
        await tx.auditLog.create({
          data: {
            actorType: 'user',
            actorId: user.id,
            action: 'user.role_added',
            targetType: 'User',
            targetId: user.id,
            before: { roles: user.roles },
            after: { roles: nextRoles },
            ip: ip ?? null,
          },
        });
      }

      return profile;
    });

    return mapOwnProfile(created, this.baseUrl);
  }

  async getOwn(user: SessionUser): Promise<ProfileDto> {
    requireRole(user, 'professional');
    const profile = await this.findOwn(user.id);
    if (!profile) {
      throw notFound();
    }
    return mapOwnProfile(profile, this.baseUrl);
  }

  async update(user: SessionUser, input: UpdateInput): Promise<ProfileDto> {
    requireRole(user, 'professional');
    const existing = await this.findOwn(user.id);
    if (!existing) {
      throw notFound();
    }

    const logoUploadId = await this.resolveUploadChange(user.id, input.logoUploadId);

    const data: Prisma.ProfessionalProfileUncheckedUpdateInput = {};
    if (input.companyName !== undefined) data.companyName = input.companyName;
    if (input.website !== undefined) data.website = input.website;
    if (input.vatNumber !== undefined) data.vatNumber = input.vatNumber;
    if (logoUploadId !== undefined) data.logoUploadId = logoUploadId;

    let updated;
    try {
      updated = await this.prisma.client.professionalProfile.update({
        where: { id: existing.id },
        data,
        include: PROFILE_WITH_LOGO_INCLUDE,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw uploadConflict();
      }
      throw error;
    }

    return mapOwnProfile(updated, this.baseUrl);
  }

  async getOwnProfileRecord(userId: string): Promise<ProfessionalProfile> {
    const profile = await this.prisma.client.professionalProfile.findUnique({ where: { userId } });
    if (!profile) {
      throw notFound();
    }
    return profile;
  }

  private async findOwn(userId: string): Promise<ProfessionalProfileWithLogo | null> {
    return this.prisma.client.professionalProfile.findUnique({
      where: { userId },
      include: PROFILE_WITH_LOGO_INCLUDE,
    });
  }

  private async resolveUploadChange(
    userId: string,
    value: string | null | undefined,
  ): Promise<string | null | undefined> {
    if (value === undefined || value === null) {
      return value;
    }
    const upload = await this.prisma.client.upload.findUnique({ where: { id: value } });
    if (upload?.ownerId !== userId) {
      throw notFound('Upload not found');
    }
    if (upload.purpose !== 'logo') {
      throw new HttpException(
        { code: 'UNPROCESSABLE_ENTITY', message: 'Upload purpose must be "logo"' },
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
