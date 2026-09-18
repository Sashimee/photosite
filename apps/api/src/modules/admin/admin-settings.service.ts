import { Inject, Injectable } from '@nestjs/common';
import type { UpdatePlatformSettingsRequestSchema } from '@photoo/shared';
import type { z } from 'zod';
import {
  PlatformSettingsService,
  type PlatformSettings,
} from '../../common/platform-settings/platform-settings.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AdminAuditService } from './admin-audit.service.js';

type UpdateInput = z.infer<typeof UpdatePlatformSettingsRequestSchema>;

interface AdminActor {
  id: string;
}

@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlatformSettingsService) private readonly platformSettings: PlatformSettingsService,
    @Inject(AdminAuditService) private readonly auditService: AdminAuditService,
  ) {}

  get(): Promise<PlatformSettings> {
    return this.platformSettings.get();
  }

  async patch(
    admin: AdminActor,
    changes: UpdateInput,
    ip: string | undefined,
  ): Promise<PlatformSettings> {
    const before = await this.platformSettings.get();
    const after: PlatformSettings = {
      feePercent: changes.feePercent ?? before.feePercent,
      autoReleaseDays: changes.autoReleaseDays ?? before.autoReleaseDays,
    };

    await this.prisma.client.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) {
          continue;
        }
        await tx.platformSetting.upsert({
          where: { key },
          create: { key, value, updatedByAdminId: admin.id },
          update: { value, updatedByAdminId: admin.id },
        });
      }

      await this.auditService.record(tx, {
        actorId: admin.id,
        action: 'platform_settings.updated',
        targetType: 'PlatformSetting',
        targetId: null,
        before,
        after,
        ip: ip ?? null,
      });
    });

    this.platformSettings.invalidate();

    return after;
  }
}
