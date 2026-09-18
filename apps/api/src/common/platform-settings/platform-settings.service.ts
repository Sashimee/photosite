import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface PlatformSettings {
  feePercent: number | null;
  autoReleaseDays: number;
}

const DEFAULT_AUTO_RELEASE_DAYS = 7;

function parseFeePercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function parseAutoReleaseDays(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? value
    : DEFAULT_AUTO_RELEASE_DAYS;
}

// No cache (#193): a 30s in-process cache meant a fee change made through
// one API replica's PATCH stayed live-but-stale on every other replica, and
// on the worker as a separate process, for up to 30s - money computed at
// two rates concurrently. Reading straight through on every call is a
// single indexed primary-key lookup, the same cost quoting already paid per
// quote with no complaint (docs/steps/1D.7-settings.md).
@Injectable()
export class PlatformSettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(): Promise<PlatformSettings> {
    const rows = await this.prisma.client.platformSetting.findMany({
      where: { key: { in: ['feePercent', 'autoReleaseDays'] } },
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    return {
      feePercent: parseFeePercent(byKey.get('feePercent')),
      autoReleaseDays: parseAutoReleaseDays(byKey.get('autoReleaseDays')),
    };
  }

  // A missing or invalid row is a misconfiguration, not the launch default:
  // every caller that turns a fee into money (quoting, payouts) must fail
  // loudly instead of silently charging 5%.
  async getFeePercent(): Promise<number> {
    const row = await this.prisma.client.platformSetting.findUnique({
      where: { key: 'feePercent' },
    });
    const feePercent = parseFeePercent(row?.value);
    if (feePercent === null) {
      throw new Error('PlatformSetting "feePercent" is missing or invalid');
    }
    return feePercent;
  }
}
