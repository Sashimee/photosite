import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface PlatformSettings {
  feePercent: number;
  autoReleaseDays: number;
}

// DATA-MODEL.md: "Holds fee percentage (default 5), auto-release days,
// feature flags." Matches the values packages/db's seed writes, so a fresh
// database with no PlatformSetting rows yet still behaves sensibly.
export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  feePercent: 5,
  autoReleaseDays: 7,
};

const CACHE_TTL_MS = 30_000;

// `invalidate()` is called by the one write path right after it commits.
@Injectable()
export class PlatformSettingsService {
  private cached: { value: PlatformSettings; expiresAt: number } | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(): Promise<PlatformSettings> {
    if (this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }
    const value = await this.readFromDatabase();
    this.cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }

  invalidate(): void {
    this.cached = null;
  }

  private async readFromDatabase(): Promise<PlatformSettings> {
    const rows = await this.prisma.client.platformSetting.findMany({
      where: { key: { in: ['feePercent', 'autoReleaseDays'] } },
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const feePercent = byKey.get('feePercent');
    const autoReleaseDays = byKey.get('autoReleaseDays');
    return {
      feePercent:
        typeof feePercent === 'number' ? feePercent : DEFAULT_PLATFORM_SETTINGS.feePercent,
      autoReleaseDays:
        typeof autoReleaseDays === 'number'
          ? autoReleaseDays
          : DEFAULT_PLATFORM_SETTINGS.autoReleaseDays,
    };
  }
}
