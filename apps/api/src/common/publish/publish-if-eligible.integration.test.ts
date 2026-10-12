import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAccountDeletion } from '../../modules/gdpr/apply-account-deletion.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { publishIfEligible } from './publish-if-eligible.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

describe('publishIfEligible concurrency integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL is not set', () => undefined);
    return;
  }

  let prisma: PrismaClient;
  const userIds: string[] = [];

  beforeAll(() => {
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function createEligiblePhotographer(): Promise<{ userId: string; profileId: string }> {
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        email: `publish-race-${suffix}@photoo.test`,
        locale: 'en',
        countryCode: 'LU',
        roles: ['client', 'photographer'],
      },
    });
    userIds.push(user.id);
    const profile = await prisma.photographerProfile.create({
      data: {
        userId: user.id,
        slug: `fx-publish-race-${suffix}`,
        displayName: 'Fx Publish Race',
        bio: {},
        links: {},
        categories: ['wedding'],
        languages: ['en'],
        city: 'Luxembourg',
        countryCode: 'LU',
        verificationStatus: 'verified',
        stripePayoutsEnabled: true,
      },
    });
    return { userId: user.id, profileId: profile.id };
  }

  it('leaves the profile unpublished when a deletion has not yet committed while publishing runs', async () => {
    const { userId, profileId } = await createEligiblePhotographer();

    let deletionHoldsUserRow!: () => void;
    const userRowLocked = new Promise<void>((resolve) => {
      deletionHoldsUserRow = resolve;
    });
    let commitDeletion!: () => void;
    const deletionMayCommit = new Promise<void>((resolve) => {
      commitDeletion = resolve;
    });

    const deletion = prisma.$transaction(async (tx) => {
      await applyAccountDeletion(tx, {
        userId,
        receivedAt: new Date(),
        channel: 'in_app',
        audit: { actorType: 'user', actorId: userId, action: 'data_request.deletion_requested' },
      });
      deletionHoldsUserRow();
      await deletionMayCommit;
    });

    await userRowLocked;
    const publishing = prisma.$transaction((tx) => publishIfEligible(tx, profileId));
    await new Promise((resolve) => setTimeout(resolve, 300));
    commitDeletion();

    const [, published] = await Promise.all([deletion, publishing]);

    expect(published).toBe(false);
    const profile = await prisma.photographerProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    expect(profile.isPublished).toBe(false);
  });

  it('records the profile as unpublished when publishing commits before the deletion reads it', async () => {
    const { userId, profileId } = await createEligiblePhotographer();

    let publisherHoldsLock!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      publisherHoldsLock = resolve;
    });
    let commitPublish!: () => void;
    const publishMayCommit = new Promise<void>((resolve) => {
      commitPublish = resolve;
    });

    const publishing = prisma.$transaction(async (tx) => {
      const result = await publishIfEligible(tx, profileId);
      publisherHoldsLock();
      await publishMayCommit;
      return result;
    });

    await lockHeld;
    const deletion = prisma.$transaction((tx) =>
      applyAccountDeletion(tx, {
        userId,
        receivedAt: new Date(),
        channel: 'in_app',
        audit: { actorType: 'user', actorId: userId, action: 'data_request.deletion_requested' },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    commitPublish();

    const [published, request] = await Promise.all([publishing, deletion]);

    expect(published).toBe(true);
    const profile = await prisma.photographerProfile.findUniqueOrThrow({
      where: { id: profileId },
    });
    expect(profile.isPublished).toBe(false);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { targetType: 'DataRequest', targetId: request.id },
    });
    expect(audit.before).toEqual({ userStatus: 'active', profileIsPublished: true });
  });
});
