import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import {
  LUXEMBOURG_REQUIRED_DOCUMENTS,
  SEED_UNVERIFIED_PHOTOGRAPHER_EMAIL,
  seedDatabase,
  seedVerificationCase,
} from './seed.js';
import { requireIntegrationEnv } from './testing/require-integration-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

const FIXTURE_USER_EMAIL = 'test-fixture.verification-user@photoo.test';

describe('verification schema', () => {
  if (!testEnv) {
    it.skip(
      'enforces the active-case partial unique index, document uniqueness and upload Restrict (skipped: TEST_DATABASE_URL is not set)',
    );
    return;
  }

  const prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

  let userId: string;

  async function deleteFixtures(): Promise<void> {
    await prisma.verificationCase.deleteMany({ where: { userId } });
    await prisma.upload.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { email: FIXTURE_USER_EMAIL } });
  }

  beforeAll(async () => {
    await seedDatabase(prisma);

    const user = await prisma.user.create({
      data: {
        email: FIXTURE_USER_EMAIL,
        emailVerifiedAt: new Date(),
        name: 'Verification Fixture User',
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'active',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await deleteFixtures();
    await prisma.$disconnect();
  });

  describe('partial unique index on userId WHERE status IN (draft, submitted, in_review)', () => {
    it('rejects a second active case and allows one again after the first is rejected', async () => {
      const firstCase = await prisma.verificationCase.create({
        data: { userId, countryCode: 'LU', status: 'draft' },
      });

      await expect(
        prisma.verificationCase.create({
          data: { userId, countryCode: 'LU', status: 'submitted' },
        }),
      ).rejects.toThrow();

      await prisma.verificationCase.update({
        where: { id: firstCase.id },
        data: { status: 'rejected' },
      });

      const secondCase = await prisma.verificationCase.create({
        data: { userId, countryCode: 'LU', status: 'draft' },
      });
      expect(secondCase.id).not.toBe(firstCase.id);

      await prisma.verificationCase.deleteMany({ where: { userId } });
    });
  });

  describe('VerificationDocument unique (caseId, documentKey)', () => {
    it('rejects a second document with the same key on the same case', async () => {
      const verificationCase = await prisma.verificationCase.create({
        data: { userId, countryCode: 'LU', status: 'draft' },
      });
      const firstUpload = await prisma.upload.create({
        data: {
          ownerId: userId,
          purpose: 'verification_document',
          status: 'clean',
          mimeType: 'application/pdf',
          declaredSizeBytes: 1024,
          objectKey: `u/${userId}/${randomUUID()}`,
          virusScanStatus: 'clean',
        },
      });
      const secondUpload = await prisma.upload.create({
        data: {
          ownerId: userId,
          purpose: 'verification_document',
          status: 'clean',
          mimeType: 'application/pdf',
          declaredSizeBytes: 1024,
          objectKey: `u/${userId}/${randomUUID()}`,
          virusScanStatus: 'clean',
        },
      });

      await prisma.verificationDocument.create({
        data: { caseId: verificationCase.id, documentKey: 'id_document', uploadId: firstUpload.id },
      });

      await expect(
        prisma.verificationDocument.create({
          data: {
            caseId: verificationCase.id,
            documentKey: 'id_document',
            uploadId: secondUpload.id,
          },
        }),
      ).rejects.toThrow();

      await prisma.verificationCase.delete({ where: { id: verificationCase.id } });
      await prisma.upload.deleteMany({
        where: { id: { in: [firstUpload.id, secondUpload.id] } },
      });
    });
  });

  describe('VerificationDocument.uploadId Restrict', () => {
    it('rejects deleting an upload that is still attached to a document', async () => {
      const verificationCase = await prisma.verificationCase.create({
        data: { userId, countryCode: 'LU', status: 'draft' },
      });
      const upload = await prisma.upload.create({
        data: {
          ownerId: userId,
          purpose: 'verification_document',
          status: 'clean',
          mimeType: 'application/pdf',
          declaredSizeBytes: 1024,
          objectKey: `u/${userId}/${randomUUID()}`,
          virusScanStatus: 'clean',
        },
      });
      await prisma.verificationDocument.create({
        data: { caseId: verificationCase.id, documentKey: 'id_document', uploadId: upload.id },
      });

      await expect(prisma.upload.delete({ where: { id: upload.id } })).rejects.toThrow();

      await prisma.verificationCase.delete({ where: { id: verificationCase.id } });
      await prisma.upload.delete({ where: { id: upload.id } });
    });

    it('rejects attaching the same upload to a second document', async () => {
      const firstCase = await prisma.verificationCase.create({
        data: { userId, countryCode: 'LU', status: 'draft' },
      });
      const upload = await prisma.upload.create({
        data: {
          ownerId: userId,
          purpose: 'verification_document',
          status: 'clean',
          mimeType: 'application/pdf',
          declaredSizeBytes: 1024,
          objectKey: `u/${userId}/${randomUUID()}`,
          virusScanStatus: 'clean',
        },
      });
      await prisma.verificationDocument.create({
        data: { caseId: firstCase.id, documentKey: 'id_document', uploadId: upload.id },
      });

      await expect(
        prisma.verificationDocument.create({
          data: { caseId: firstCase.id, documentKey: 'proof_of_address', uploadId: upload.id },
        }),
      ).rejects.toThrow();

      await prisma.verificationCase.delete({ where: { id: firstCase.id } });
      await prisma.upload.delete({ where: { id: upload.id } });
    });
  });

  describe('seedVerificationCase', () => {
    it('seeds one submitted case with every required document, clean, and is idempotent', async () => {
      const seedUser = await prisma.user.findUniqueOrThrow({
        where: { email: SEED_UNVERIFIED_PHOTOGRAPHER_EMAIL },
      });

      const verificationCase = await prisma.verificationCase.findFirstOrThrow({
        where: { userId: seedUser.id },
        include: { documents: { include: { upload: true } } },
      });

      expect(verificationCase.status).toBe('submitted');
      expect(verificationCase.submittedAt).not.toBeNull();
      expect(verificationCase.businessName).not.toBeNull();
      expect(verificationCase.businessName).not.toContain('Hassan');
      expect(verificationCase.documents).toHaveLength(LUXEMBOURG_REQUIRED_DOCUMENTS.length);
      for (const document of verificationCase.documents) {
        expect(document.upload.virusScanStatus).toBe('clean');
        expect(document.upload.status).toBe('clean');
      }

      await seedVerificationCase(prisma);

      const caseCountAfterSecondRun = await prisma.verificationCase.count({
        where: { userId: seedUser.id },
      });
      expect(caseCountAfterSecondRun).toBe(1);
      const documentCountAfterSecondRun = await prisma.verificationDocument.count({
        where: { caseId: verificationCase.id },
      });
      expect(documentCountAfterSecondRun).toBe(LUXEMBOURG_REQUIRED_DOCUMENTS.length);
    });
  });
});
