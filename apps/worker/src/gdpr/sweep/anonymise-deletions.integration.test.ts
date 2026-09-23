import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogService } from '../../common/audit-log.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { anonymiseDeletions } from './anonymise-deletions.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

function fakeLogger() {
  return { log: () => undefined, warn: () => undefined, error: () => undefined };
}

const THIRTY_ONE_DAYS_AGO = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
const ONE_DAY_AGO = new Date(Date.now() - 24 * 60 * 60 * 1000);

describe('anonymiseDeletions against a real database and MinIO', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL is not set', () => undefined);
    return;
  }

  let prisma: PrismaClient;
  let auditLog: AuditLogService;
  const storage = new StorageService(TEST_ENV);
  const runId = randomUUID().replaceAll('-', '').slice(0, 8);

  let dueUserId: string;
  let dueRequestId: string;
  let notDueUserId: string;
  let notDueRequestId: string;
  let profileId: string;
  let portfolioObjectKey: string;
  let portfolioVariantKey: string;
  let dueRequest: { id: string };
  let employerId: string;
  let jobOfferId: string;
  let jobApplicationId: string;
  let dueUser2Id: string;
  let dueRequest2Id: string;
  let profile2Id: string;

  beforeAll(async () => {
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    auditLog = new AuditLogService({ client: prisma } as never);

    const dueUser = await prisma.user.create({
      data: {
        email: `gdpr-anon-due-${runId}@photoo.test`,
        name: 'Fx Anon Due',
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'deleted',
        deletedAt: THIRTY_ONE_DAYS_AGO,
      },
    });
    dueUserId = dueUser.id;

    await prisma.session.create({
      data: {
        userId: dueUserId,
        tokenHash: `hash-${runId}-due`,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.device.create({
      data: {
        userId: dueUserId,
        expoPushToken: `token-${runId}-due`,
        platform: 'ios',
        lastSeenAt: new Date(),
      },
    });

    portfolioObjectKey = `worker-gdpr-anon-test/${runId}/portfolio.jpg`;
    await storage.putObject({
      bucket: storage.config.privateBucket,
      key: portfolioObjectKey,
      body: Buffer.from('portfolio-bytes'),
      contentType: 'image/jpeg',
    });
    portfolioVariantKey = `worker-gdpr-anon-test/${runId}/portfolio-thumb.webp`;
    await storage.putObject({
      bucket: storage.config.publicBucket,
      key: portfolioVariantKey,
      body: Buffer.from('portfolio-variant-bytes'),
      contentType: 'image/webp',
    });
    const upload = await prisma.upload.create({
      data: {
        ownerId: dueUserId,
        purpose: 'portfolio',
        status: 'processed',
        mimeType: 'image/jpeg',
        declaredSizeBytes: 10,
        actualSizeBytes: 10,
        objectKey: portfolioObjectKey,
        variants: { thumb_webp: portfolioVariantKey },
        virusScanStatus: 'clean',
      },
    });

    const profile = await prisma.photographerProfile.create({
      data: {
        userId: dueUserId,
        slug: `fx-gdpr-anon-${runId}`,
        displayName: 'Fx Anon Photographer',
        headline: 'A headline that must be cleared',
        bio: { text: 'a bio that must be cleared' },
        links: { site: 'https://example.com' },
        categories: ['wedding'],
        languages: ['en'],
        city: 'Luxembourg',
        countryCode: 'LU',
      },
    });
    profileId = profile.id;

    await prisma.portfolioImage.create({
      data: { profileId: profile.id, uploadId: upload.id, order: 0, status: 'approved' },
    });
    await prisma.product.create({
      data: {
        profileId: profile.id,
        title: { en: 'Wedding coverage' },
        category: 'wedding',
        durationMinutes: 60,
        deliverables: { photos: 100 },
        basePriceCents: 10000,
        currency: 'EUR',
        order: 0,
      },
    });

    dueRequest = await prisma.dataRequest.create({
      data: {
        userId: dueUserId,
        type: 'delete',
        status: 'pending',
        requestedAt: THIRTY_ONE_DAYS_AGO,
      },
    });
    dueRequestId = dueRequest.id;

    await prisma.professionalProfile.create({
      data: {
        userId: dueUserId,
        companyName: `Fx Anon Co ${runId}`,
        website: 'https://example.com',
        vatNumber: `LU${runId}`,
      },
    });

    const employer = await prisma.user.create({
      data: {
        email: `gdpr-anon-employer-${runId}@photoo.test`,
        name: 'Fx Anon Employer',
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'active',
      },
    });
    employerId = employer.id;
    const employerProfile = await prisma.professionalProfile.create({
      data: { userId: employerId, companyName: `Fx Anon Employer Co ${runId}` },
    });
    const jobOffer = await prisma.jobOffer.create({
      data: {
        professionalId: employerProfile.id,
        slug: `fx-anon-offer-${runId}`,
        title: `Fx Anon Job Offer ${runId}`,
        description: 'A fixture job offer for the gdpr-sweep test.',
        category: 'wedding',
        city: 'Luxembourg',
        countryCode: 'LU',
        status: 'published',
        publishedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    });
    jobOfferId = jobOffer.id;
    const jobApplication = await prisma.jobApplication.create({
      data: {
        jobOfferId: jobOffer.id,
        photographerId: profileId,
        message: 'A message that must be blanked.',
        portfolioLink: 'https://example.com/portfolio',
      },
    });
    jobApplicationId = jobApplication.id;

    const notDueUser = await prisma.user.create({
      data: {
        email: `gdpr-anon-notdue-${runId}@photoo.test`,
        name: 'Fx Anon Not Due',
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'deleted',
        deletedAt: ONE_DAY_AGO,
      },
    });
    notDueUserId = notDueUser.id;

    const notDueRequest = await prisma.dataRequest.create({
      data: {
        userId: notDueUserId,
        type: 'delete',
        status: 'pending',
        requestedAt: ONE_DAY_AGO,
      },
    });
    notDueRequestId = notDueRequest.id;

    const dueUser2 = await prisma.user.create({
      data: {
        email: `gdpr-anon-due2-${runId}@photoo.test`,
        name: 'Fx Anon Due Two',
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'deleted',
        deletedAt: THIRTY_ONE_DAYS_AGO,
      },
    });
    dueUser2Id = dueUser2.id;

    const profile2 = await prisma.photographerProfile.create({
      data: {
        userId: dueUser2Id,
        slug: `fx-gdpr-anon-two-${runId}`,
        displayName: 'Fx Anon Photographer Two',
        headline: 'A second headline that must be cleared',
        bio: { text: 'a second bio that must be cleared' },
        links: { site: 'https://example.com' },
        categories: ['wedding'],
        languages: ['en'],
        city: 'Luxembourg',
        countryCode: 'LU',
      },
    });
    profile2Id = profile2.id;

    const dueRequest2 = await prisma.dataRequest.create({
      data: {
        userId: dueUser2Id,
        type: 'delete',
        status: 'pending',
        requestedAt: THIRTY_ONE_DAYS_AGO,
      },
    });
    dueRequest2Id = dueRequest2.id;
  });

  afterAll(async () => {
    await storage
      .deleteObject(storage.config.privateBucket, portfolioObjectKey)
      .catch(() => undefined);
    await storage
      .deleteObject(storage.config.publicBucket, portfolioVariantKey)
      .catch(() => undefined);
    await prisma.portfolioImage.deleteMany({ where: { profileId } });
    await prisma.product.deleteMany({ where: { profileId } });
    await prisma.jobApplication.deleteMany({ where: { id: jobApplicationId } });
    await prisma.jobOffer.deleteMany({ where: { id: jobOfferId } });
    await prisma.professionalProfile.deleteMany({
      where: { userId: { in: [dueUserId, employerId] } },
    });
    await prisma.photographerProfile.deleteMany({ where: { id: { in: [profileId, profile2Id] } } });
    await prisma.upload.deleteMany({ where: { ownerId: dueUserId } });
    await prisma.session.deleteMany({ where: { userId: { in: [dueUserId, notDueUserId] } } });
    await prisma.device.deleteMany({ where: { userId: { in: [dueUserId, notDueUserId] } } });
    await prisma.auditLog.deleteMany({
      where: { targetType: 'User', targetId: { in: [dueUserId, dueUser2Id] } },
    });
    await prisma.dataRequest.deleteMany({
      where: { id: { in: [dueRequestId, notDueRequestId, dueRequest2Id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [dueUserId, notDueUserId, employerId, dueUser2Id] } },
    });
    await prisma.$disconnect();
  });

  it('anonymises only the deletion past 30 days and leaves the other alone', async () => {
    const result = await anonymiseDeletions({
      prisma: { client: prisma },
      storage,
      auditLog,
      logger: fakeLogger() as never,
    });

    expect(result.usersAnonymised).toBeGreaterThanOrEqual(2);

    const dueUser = await prisma.user.findUniqueOrThrow({ where: { id: dueUserId } });
    expect(dueUser.email).toBe(`deleted-${dueUserId}@deleted.invalid`);
    expect(dueUser.name).toBeNull();
    expect(dueUser.locale).toBe('en');

    const dueRow = await prisma.dataRequest.findUniqueOrThrow({ where: { id: dueRequestId } });
    expect(dueRow.status).toBe('completed');
    expect(dueRow.completedAt).not.toBeNull();

    const sessions = await prisma.session.findMany({ where: { userId: dueUserId } });
    const devices = await prisma.device.findMany({ where: { userId: dueUserId } });
    expect(sessions).toHaveLength(0);
    expect(devices).toHaveLength(0);

    const profile = await prisma.photographerProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    expect(profile.headline).toBeNull();
    expect(profile.languages).toEqual([]);
    expect(profile.displayName).toBe('Deleted user');
    expect(profile.slug).toBe(`deleted-${profileId}`);
    expect(profile.slug).not.toContain('fx-gdpr-anon');

    const profile2 = await prisma.photographerProfile.findUniqueOrThrow({
      where: { id: profile2Id },
    });
    expect(profile2.slug).toBe(`deleted-${profile2Id}`);
    expect(profile2.slug).not.toContain('fx-gdpr-anon');
    expect(profile2.slug).not.toBe(profile.slug);

    const bySlug = await prisma.photographerProfile.findUnique({
      where: { slug: `fx-gdpr-anon-${runId}` },
    });
    expect(bySlug).toBeNull();

    const professionalProfile = await prisma.professionalProfile.findUniqueOrThrow({
      where: { userId: dueUserId },
    });
    expect(professionalProfile.companyName).toBe('Deleted company');
    expect(professionalProfile.website).toBeNull();
    expect(professionalProfile.vatNumber).toBeNull();

    const jobApplication = await prisma.jobApplication.findUniqueOrThrow({
      where: { id: jobApplicationId },
    });
    expect(jobApplication.message).toBe('');
    expect(jobApplication.portfolioLink).toBeNull();
    expect(jobApplication.jobOfferId).toBe(jobOfferId);
    expect(jobApplication.status).toBe('submitted');
    expect(jobApplication.createdAt).not.toBeNull();
    expect(jobApplication.updatedAt).not.toBeNull();

    const portfolioImages = await prisma.portfolioImage.findMany({ where: { profileId } });
    const products = await prisma.product.findMany({ where: { profileId } });
    expect(portfolioImages).toHaveLength(0);
    expect(products).toHaveLength(0);

    const uploads = await prisma.upload.findMany({ where: { ownerId: dueUserId } });
    expect(uploads).toHaveLength(0);
    await expect(
      storage.getObjectBuffer(storage.config.privateBucket, portfolioObjectKey),
    ).rejects.toThrow();
    await expect(
      storage.getObjectBuffer(storage.config.publicBucket, portfolioVariantKey),
    ).rejects.toThrow();

    const auditRow = await prisma.auditLog.findFirst({
      where: { targetType: 'User', targetId: dueUserId, action: 'gdpr_sweep.anonymised' },
    });
    expect(auditRow).not.toBeNull();
    expect(JSON.stringify(auditRow?.after)).not.toContain('@photoo.test');

    const notDueUser = await prisma.user.findUniqueOrThrow({ where: { id: notDueUserId } });
    expect(notDueUser.email).toBe(`gdpr-anon-notdue-${runId}@photoo.test`);
    const notDueRow = await prisma.dataRequest.findUniqueOrThrow({
      where: { id: notDueRequestId },
    });
    expect(notDueRow.status).toBe('pending');

    // The due request is now `completed`, so a second sweep run finds
    // nothing left to anonymise and every already-anonymised row is
    // unchanged.
    const second = await anonymiseDeletions({
      prisma: { client: prisma },
      storage,
      auditLog,
      logger: fakeLogger() as never,
    });
    expect(second.usersAnonymised).toBe(0);
    expect(second.usersFailed).toBe(0);

    const jobApplicationAfterSecondRun = await prisma.jobApplication.findUniqueOrThrow({
      where: { id: jobApplicationId },
    });
    expect(jobApplicationAfterSecondRun.message).toBe('');
    expect(jobApplicationAfterSecondRun.portfolioLink).toBeNull();

    const professionalProfileAfterSecondRun = await prisma.professionalProfile.findUniqueOrThrow({
      where: { userId: dueUserId },
    });
    expect(professionalProfileAfterSecondRun.companyName).toBe('Deleted company');

    const profileAfterSecondRun = await prisma.photographerProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    expect(profileAfterSecondRun.slug).toBe(`deleted-${profileId}`);
  });
});
