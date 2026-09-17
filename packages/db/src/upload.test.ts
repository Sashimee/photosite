import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import { seedDatabase } from './seed.js';
import { requireIntegrationEnv } from './testing/require-integration-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

describe('upload schema', () => {
  if (!testEnv) {
    it.skip(
      'enforces objectKey uniqueness and restricts deleting a user with uploads (skipped: TEST_DATABASE_URL is not set)',
    );
    return;
  }

  const prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createTestUser(email: string) {
    await seedDatabase(prisma);
    return prisma.user.create({
      data: {
        email,
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'active',
      },
    });
  }

  describe('Upload.objectKey uniqueness', () => {
    it('rejects a duplicate objectKey', async () => {
      const user = await createTestUser(`upload-objectkey-${randomUUID()}@example.com`);
      const objectKey = `u/${user.id}/${randomUUID()}`;

      const upload = await prisma.upload.create({
        data: {
          ownerId: user.id,
          purpose: 'portfolio',
          mimeType: 'image/jpeg',
          declaredSizeBytes: 1024,
          objectKey,
        },
      });

      await expect(
        prisma.upload.create({
          data: {
            ownerId: user.id,
            purpose: 'portfolio',
            mimeType: 'image/jpeg',
            declaredSizeBytes: 2048,
            objectKey,
          },
        }),
      ).rejects.toThrow();

      await prisma.upload.delete({ where: { id: upload.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('Upload.ownerId onDelete Restrict', () => {
    it('rejects deleting a user that still owns an upload', async () => {
      const user = await createTestUser(`upload-restrict-${randomUUID()}@example.com`);
      const upload = await prisma.upload.create({
        data: {
          ownerId: user.id,
          purpose: 'avatar',
          mimeType: 'image/png',
          declaredSizeBytes: 512,
          objectKey: `u/${user.id}/${randomUUID()}`,
        },
      });

      await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();

      await prisma.upload.delete({ where: { id: upload.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });
});
