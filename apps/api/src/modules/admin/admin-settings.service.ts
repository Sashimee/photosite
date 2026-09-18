import { Inject, Injectable } from '@nestjs/common';
import {
  FEATURE_FLAG_DESCRIPTIONS,
  FEATURE_FLAG_KEYS,
  type FeatureFlagKey,
  type UpdatePlatformSettingsRequestSchema,
} from '@photoo/shared';
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

export interface FeatureFlagState {
  key: FeatureFlagKey;
  description: string;
  enabled: boolean;
}

export interface AdminPlatformSettings extends PlatformSettings {
  featureFlags: FeatureFlagState[];
}

function featureFlagSettingKey(key: FeatureFlagKey): string {
  return `featureFlag.${key}`;
}

@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PlatformSettingsService) private readonly platformSettings: PlatformSettingsService,
    @Inject(AdminAuditService) private readonly auditService: AdminAuditService,
  ) {}

  async get(): Promise<AdminPlatformSettings> {
    const settings = await this.platformSettings.get();
    const featureFlags = await this.getFeatureFlags();
    return { ...settings, featureFlags };
  }

  private async getFeatureFlags(): Promise<FeatureFlagState[]> {
    const rows = await this.prisma.client.platformSetting.findMany({
      where: { key: { in: FEATURE_FLAG_KEYS.map(featureFlagSettingKey) } },
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    return FEATURE_FLAG_KEYS.map((key) => ({
      key,
      description: FEATURE_FLAG_DESCRIPTIONS[key],
      enabled: byKey.get(featureFlagSettingKey(key)) === true,
    }));
  }

  async patch(
    admin: AdminActor,
    changes: UpdateInput,
    ip: string | undefined,
  ): Promise<AdminPlatformSettings> {
    const before = await this.get();
    const flagChanges = new Map(
      (changes.featureFlags ?? []).map((entry) => [entry.key, entry.enabled]),
    );

    const after: AdminPlatformSettings = {
      feePercent: changes.feePercent ?? before.feePercent,
      autoReleaseDays: changes.autoReleaseDays ?? before.autoReleaseDays,
      featureFlags: before.featureFlags.map((flag) => {
        const enabled = flagChanges.get(flag.key);
        return enabled === undefined ? flag : { ...flag, enabled };
      }),
    };

    await this.prisma.client.$transaction(async (tx) => {
      if (changes.feePercent !== undefined) {
        await tx.platformSetting.upsert({
          where: { key: 'feePercent' },
          create: { key: 'feePercent', value: changes.feePercent, updatedByAdminId: admin.id },
          update: { value: changes.feePercent, updatedByAdminId: admin.id },
        });
      }
      if (changes.autoReleaseDays !== undefined) {
        await tx.platformSetting.upsert({
          where: { key: 'autoReleaseDays' },
          create: {
            key: 'autoReleaseDays',
            value: changes.autoReleaseDays,
            updatedByAdminId: admin.id,
          },
          update: { value: changes.autoReleaseDays, updatedByAdminId: admin.id },
        });
      }
      for (const [key, enabled] of flagChanges) {
        const settingKey = featureFlagSettingKey(key);
        await tx.platformSetting.upsert({
          where: { key: settingKey },
          create: { key: settingKey, value: enabled, updatedByAdminId: admin.id },
          update: { value: enabled, updatedByAdminId: admin.id },
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

    return after;
  }
}
