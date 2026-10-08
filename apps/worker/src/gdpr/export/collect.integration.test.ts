import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { collectExportData, type PortfolioImageExportRow } from './collect.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

const WITHHELD_FIELDS = [
  'score',
  'aiScore',
  'aiVendor',
  'reverseMatches',
  'c2paValid',
  'exifCamera',
  'exifCapturedAt',
  'note',
  'reviewedByAdminId',
  'raw',
];

describe('collectExportData portfolio provenance against a real database', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL is not set', () => undefined);
    return;
  }

  let prisma: PrismaClient;
  const runId = randomUUID().replaceAll('-', '').slice(0, 8);
  const userIds: string[] = [];
  let subjectId: string;
  let profileId: string;
  let checkedImageId: string;
  let uncheckedImageId: string;
  const reviewedAt = new Date('2026-03-02T10:00:00.000Z');
  const exifCamera = `SECRET-CAMERA-${runId}`;
  const aiVendor = `secret-vendor-${runId}`;
  const note = `SECRET-ADMIN-NOTE-${runId}`;

  async function createImage(order: number): Promise<string> {
    const upload = await prisma.upload.create({
      data: {
        ownerId: subjectId,
        purpose: 'portfolio',
        status: 'processed',
        mimeType: 'image/jpeg',
        declaredSizeBytes: 10,
        actualSizeBytes: 10,
        objectKey: `worker-collect-prov-test/${runId}/${String(order)}.jpg`,
        virusScanStatus: 'clean',
      },
    });
    const image = await prisma.portfolioImage.create({
      data: { profileId, uploadId: upload.id, order, status: 'rejected' },
    });
    return image.id;
  }

  async function exportedImages(): Promise<PortfolioImageExportRow[]> {
    return (await collectExportData(prisma, subjectId)).portfolioImages;
  }

  beforeAll(async () => {
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    const subject = await prisma.user.create({
      data: {
        email: `collect-prov-subject-${runId}@photoo.test`,
        name: 'Fx Collect Prov',
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'active',
      },
    });
    subjectId = subject.id;
    userIds.push(subject.id);
    const admin = await prisma.user.create({
      data: {
        email: `collect-prov-admin-${runId}@photoo.test`,
        name: 'Fx Collect Admin',
        locale: 'en',
        countryCode: 'LU',
        roles: ['admin'],
        status: 'active',
      },
    });
    userIds.push(admin.id);
    const profile = await prisma.photographerProfile.create({
      data: {
        userId: subjectId,
        slug: `fx-collect-prov-${runId}`,
        displayName: 'Fx Collect Prov',
        bio: {},
        links: {},
        categories: ['wedding'],
        languages: ['en'],
        city: 'Luxembourg',
        countryCode: 'LU',
      },
    });
    profileId = profile.id;

    checkedImageId = await createImage(0);
    uncheckedImageId = await createImage(1);
    await prisma.provenanceCheck.create({
      data: {
        portfolioImageId: checkedImageId,
        aiScore: 0.91,
        aiVendor,
        reverseMatches: ['https://example.com/secret-match'],
        c2paValid: false,
        exifCamera,
        exifCapturedAt: new Date('2026-01-01T00:00:00.000Z'),
        score: 0.87,
        verdict: 'fail',
        reviewedByAdminId: admin.id,
        reviewedAt,
        note,
        decisionReason: 'other',
        decisionReasonText: `Reason text ${runId}`,
        raw: { vendor: `secret-raw-${runId}` },
      },
    });
  });

  afterAll(async () => {
    await prisma.photographerProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.upload.deleteMany({ where: { ownerId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it('exports verdict, check time, review time and the statement of reasons', async () => {
    const check = await prisma.provenanceCheck.findUniqueOrThrow({
      where: { portfolioImageId: checkedImageId },
    });
    const image = (await exportedImages()).find((row) => row.id === checkedImageId);

    expect(image?.provenance).toEqual({
      verdict: 'fail',
      checkedAt: check.createdAt.toISOString(),
      reviewedAt: reviewedAt.toISOString(),
      decisionReason: 'other',
      decisionReasonText: `Reason text ${runId}`,
    });
  });

  it('withholds every other provenance field from the whole row', async () => {
    const images = await exportedImages();
    const image = images.find((row) => row.id === checkedImageId);

    expect(Object.keys(image?.provenance ?? {}).sort()).toEqual([
      'checkedAt',
      'decisionReason',
      'decisionReasonText',
      'reviewedAt',
      'verdict',
    ]);
    const serialised = JSON.stringify(images);
    for (const field of WITHHELD_FIELDS) {
      expect(serialised).not.toContain(`"${field}"`);
    }
    for (const secret of [exifCamera, aiVendor, note, 'secret-match', `secret-raw-${runId}`]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('exports provenance null for an image without a check', async () => {
    const image = (await exportedImages()).find((row) => row.id === uncheckedImageId);

    expect(image).toBeDefined();
    expect(image?.provenance).toBeNull();
  });
});
