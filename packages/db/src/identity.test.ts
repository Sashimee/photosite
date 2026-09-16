import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import { seedDatabase } from './seed.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe('identity schema', () => {
  if (!testDatabaseUrl) {
    it.skip(
      'enforces citext uniqueness and the consent subject check constraint (skipped: TEST_DATABASE_URL is not set)',
    );
    return;
  }

  const prisma = createPrismaClient(testDatabaseUrl);

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

  describe('User.email citext uniqueness', () => {
    it('rejects a case-insensitive duplicate email', async () => {
      const email = `citext-${randomUUID()}@example.com`;
      const created = await createTestUser(email);

      await expect(createTestUser(email.toUpperCase())).rejects.toThrow();

      await prisma.user.delete({ where: { id: created.id } });
    });
  });

  describe('ConsentRecord subject check constraint', () => {
    const base = {
      purpose: 'analytics' as const,
      granted: true,
      policyVersion: '2026-01-01',
    };

    it('rejects a record with neither userId nor anonymousId set', async () => {
      await expect(prisma.consentRecord.create({ data: { ...base } })).rejects.toThrow();
    });

    it('rejects a record with both userId and anonymousId set', async () => {
      const user = await createTestUser(`consent-${randomUUID()}@example.com`);

      await expect(
        prisma.consentRecord.create({
          data: { ...base, userId: user.id, anonymousId: randomUUID() },
        }),
      ).rejects.toThrow();

      await prisma.user.delete({ where: { id: user.id } });
    });

    it('accepts a record with exactly one of userId or anonymousId set', async () => {
      const record = await prisma.consentRecord.create({
        data: { ...base, anonymousId: randomUUID() },
      });

      expect(record.userId).toBeNull();
      expect(record.anonymousId).not.toBeNull();

      await prisma.consentRecord.delete({ where: { id: record.id } });
    });
  });
});
