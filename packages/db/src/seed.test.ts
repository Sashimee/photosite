import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import { LUXEMBOURG_REQUIRED_DOCUMENTS, seedDatabase } from './seed.js';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe('seedDatabase', () => {
  if (!testDatabaseUrl) {
    it.skip(
      'seeds Luxembourg and platform settings idempotently (skipped: TEST_DATABASE_URL is not set)',
    );
    return;
  }

  const prisma = createPrismaClient(testDatabaseUrl);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeds the Luxembourg country row with the expected shape', async () => {
    await seedDatabase(prisma);

    const country = await prisma.country.findUniqueOrThrow({ where: { code: 'LU' } });

    expect(country.name).toBe('Luxembourg');
    expect(country.enabled).toBe(true);
    expect(country.currency).toBe('EUR');
    expect(country.defaultLocale).toBe('fr');
    expect(country.vatRate.toNumber()).toBe(17);
    expect(country.requiredDocuments).toEqual(LUXEMBOURG_REQUIRED_DOCUMENTS);
  });

  it('seeds the feePercent and autoReleaseDays platform settings', async () => {
    await seedDatabase(prisma);

    const feePercent = await prisma.platformSetting.findUniqueOrThrow({
      where: { key: 'feePercent' },
    });
    const autoReleaseDays = await prisma.platformSetting.findUniqueOrThrow({
      where: { key: 'autoReleaseDays' },
    });

    expect(feePercent.value).toBe(5);
    expect(autoReleaseDays.value).toBe(7);
  });

  it('is idempotent: running the seed again does not modify existing rows', async () => {
    await seedDatabase(prisma);
    const before = await prisma.country.findUniqueOrThrow({ where: { code: 'LU' } });

    await seedDatabase(prisma);
    const after = await prisma.country.findUniqueOrThrow({ where: { code: 'LU' } });

    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await prisma.country.count()).toBe(1);
    expect(await prisma.platformSetting.count()).toBe(2);
  });
});
