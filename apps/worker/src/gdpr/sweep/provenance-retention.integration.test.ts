import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient, type ProvenanceVerdict } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { provenanceRetention } from './provenance-retention.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

function fakeLogger() {
  return { log: () => undefined, warn: () => undefined, error: () => undefined };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NINETY_ONE_DAYS_AGO = new Date(Date.now() - 91 * DAY_MS);
function required<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('fixture value missing');
  }
  return value;
}

const TWO_HUNDRED_DAYS_AGO = new Date(Date.now() - 200 * DAY_MS);
const RAW = { vendor: 'payload' };

describe('provenanceRetention against a real database', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL is not set', () => undefined);
    return;
  }

  let prisma: PrismaClient;
  const runId = randomUUID().replaceAll('-', '').slice(0, 8);
  const userIds: string[] = [];
  const reportIds: string[] = [];
  let profileAId: string;
  let profileBId: string;
  const images: Record<string, string> = {};

  async function createProfile(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `prov-ret-${label}-${runId}@photoo.test`,
        name: `Fx Prov ${label}`,
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'active',
      },
    });
    userIds.push(user.id);
    const profile = await prisma.photographerProfile.create({
      data: {
        userId: user.id,
        slug: `fx-prov-ret-${label}-${runId}`,
        displayName: `Fx Prov ${label}`,
        bio: {},
        links: {},
        categories: ['wedding'],
        languages: ['en'],
        city: 'Luxembourg',
        countryCode: 'LU',
      },
    });
    return profile.id;
  }

  async function createImage(
    name: string,
    profileId: string,
    options: {
      deleted?: boolean;
      verdict?: ProvenanceVerdict;
      raw?: boolean;
      createdAt?: Date;
    },
  ): Promise<void> {
    const ownerId = required(userIds[profileId === profileAId ? 0 : 1]);
    const upload = await prisma.upload.create({
      data: {
        ownerId,
        purpose: 'portfolio',
        status: 'processed',
        mimeType: 'image/jpeg',
        declaredSizeBytes: 10,
        actualSizeBytes: 10,
        objectKey: `worker-prov-ret-test/${runId}/${name}.jpg`,
        virusScanStatus: 'clean',
      },
    });
    const image = await prisma.portfolioImage.create({
      data: {
        profileId,
        uploadId: upload.id,
        order: Object.keys(images).length,
        status: 'approved',
        deletedAt: options.deleted ? new Date() : null,
      },
    });
    images[name] = image.id;
    await prisma.provenanceCheck.create({
      data: {
        portfolioImageId: image.id,
        aiVendor: 'test',
        reverseMatches: [],
        score: 0.1,
        verdict: options.verdict ?? 'pass',
        ...(options.raw ? { raw: RAW } : {}),
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      },
    });
  }

  async function checkOf(name: string) {
    return prisma.provenanceCheck.findUnique({
      where: { portfolioImageId: required(images[name]) },
    });
  }

  async function run(batchSize?: number) {
    return provenanceRetention({
      prisma: { client: prisma },
      logger: fakeLogger() as never,
      ...(batchSize === undefined ? {} : { batchSize }),
    });
  }

  beforeAll(async () => {
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    profileAId = await createProfile('a');
    profileBId = await createProfile('b');

    await createImage('deleted', profileAId, { deleted: true, raw: true });
    await createImage('live', profileAId, {});
    await createImage('heldByImageReport', profileAId, { deleted: true });
    await createImage('dismissedReport', profileAId, { deleted: true });
    await createImage('recentTakedown', profileAId, { deleted: true });
    await createImage('oldTakedown', profileAId, { deleted: true });
    await createImage('heldByProfileReport', profileBId, { deleted: true });
    await createImage('oldPass', profileAId, {
      raw: true,
      createdAt: NINETY_ONE_DAYS_AGO,
    });
    await createImage('recentPass', profileAId, { raw: true });
    await createImage('oldReview', profileAId, {
      verdict: 'review',
      raw: true,
      createdAt: NINETY_ONE_DAYS_AGO,
    });
    await createImage('oldFail', profileAId, {
      verdict: 'fail',
      raw: true,
      createdAt: NINETY_ONE_DAYS_AGO,
    });

    const reports = await Promise.all([
      prisma.report.create({
        data: {
          targetType: 'portfolio_image',
          targetId: required(images.heldByImageReport),
          reason: 'fx',
          status: 'open',
        },
      }),
      prisma.report.create({
        data: {
          targetType: 'portfolio_image',
          targetId: required(images.dismissedReport),
          reason: 'fx',
          status: 'dismissed',
        },
      }),
      prisma.report.create({
        data: {
          targetType: 'portfolio_image',
          targetId: required(images.recentTakedown),
          reason: 'fx',
          status: 'resolved',
        },
      }),
      prisma.report.create({
        data: {
          targetType: 'portfolio_image',
          targetId: required(images.oldTakedown),
          reason: 'fx',
          status: 'resolved',
          updatedAt: TWO_HUNDRED_DAYS_AGO,
        },
      }),
      prisma.report.create({
        data: {
          targetType: 'photographer_profile',
          targetId: profileBId,
          reason: 'fx',
          status: 'open',
        },
      }),
    ]);
    reportIds.push(...reports.map((report) => report.id));

    await run();
  });

  afterAll(async () => {
    await prisma.report.deleteMany({ where: { id: { in: reportIds } } });
    await prisma.photographerProfile.deleteMany({
      where: { id: { in: [profileAId, profileBId] } },
    });
    await prisma.upload.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('removes the check of a deleted image and keeps the check of a live one', async () => {
    expect(await checkOf('deleted')).toBeNull();
    expect(await checkOf('live')).not.toBeNull();
    expect(await checkOf('dismissedReport')).toBeNull();
    expect(await checkOf('oldTakedown')).toBeNull();
  });

  it('keeps the check of a deleted image while an open report holds it', async () => {
    expect(await checkOf('heldByImageReport')).not.toBeNull();
    expect(await checkOf('heldByProfileReport')).not.toBeNull();
    expect(await checkOf('recentTakedown')).not.toBeNull();
  });

  it('releases a held check on a later run once the report is closed', async () => {
    await prisma.report.update({
      where: { id: required(reportIds[0]) },
      data: { status: 'dismissed' },
    });
    await run();
    expect(await checkOf('heldByImageReport')).toBeNull();
    expect(await checkOf('heldByProfileReport')).not.toBeNull();
  });

  it('clears raw of a pass older than 90 days only', async () => {
    expect((await checkOf('oldPass'))?.raw).toBeNull();
    expect((await checkOf('recentPass'))?.raw).toEqual(RAW);
    expect((await checkOf('oldReview'))?.raw).toEqual(RAW);
    expect((await checkOf('oldFail'))?.raw).toEqual(RAW);
  });

  it('is a no-op on a second run', async () => {
    const before = await checkOf('recentPass');
    const result = await run();
    expect(result.checksDeleted).toBe(0);
    expect(result.rawCleared).toBe(0);
    expect(await checkOf('recentPass')).toEqual(before);
    expect(await checkOf('heldByProfileReport')).not.toBeNull();
  });

  it('drains every batch of deletable checks in one run, skipping a held one in the middle', async () => {
    const names = ['multi1', 'multi2', 'multi3', 'multi4', 'multi5'];
    for (const name of names) {
      await createImage(name, profileAId, { deleted: true });
    }
    const report = await prisma.report.create({
      data: {
        targetType: 'portfolio_image',
        targetId: required(images.multi3),
        reason: 'fx',
        status: 'open',
      },
    });
    reportIds.push(report.id);

    const result = await run(2);

    expect(result.checksDeleted).toBeGreaterThanOrEqual(4);
    for (const name of names) {
      if (name === 'multi3') {
        expect(await checkOf(name)).not.toBeNull();
      } else {
        expect(await checkOf(name)).toBeNull();
      }
    }
  });
});
