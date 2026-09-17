import { verify } from '@node-rs/argon2';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import {
  CREDENTIAL_PROVIDER_ID,
  LUXEMBOURG_REQUIRED_DOCUMENTS,
  SEED_USERS,
  getSeedUserPassword,
  seedDatabase,
} from './seed.js';
import { requireIntegrationEnv } from './testing/require-integration-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

describe('seedDatabase', () => {
  if (!testEnv) {
    it.skip(
      'seeds Luxembourg and platform settings idempotently (skipped: TEST_DATABASE_URL is not set)',
    );
    return;
  }

  const prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

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

  it('seeds one active user per role with no roles missing', async () => {
    await seedDatabase(prisma);

    for (const { email, roles } of SEED_USERS) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.roles).toEqual([...roles]);
      expect(user.status).toBe('active');
      expect(user.emailVerifiedAt).not.toBeNull();
    }
  });

  it('sets each seed user name to the email local part', async () => {
    await seedDatabase(prisma);

    for (const { email } of SEED_USERS) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.name).toBe(email.split('@')[0]);
    }
  });

  it('backfills the name of an existing seed user row with no name', async () => {
    const [firstSeedUser] = SEED_USERS;
    if (!firstSeedUser) {
      throw new Error('SEED_USERS is empty');
    }

    await seedDatabase(prisma);
    await prisma.user.update({
      where: { email: firstSeedUser.email },
      data: { name: null },
    });

    await seedDatabase(prisma);
    const backfilled = await prisma.user.findUniqueOrThrow({
      where: { email: firstSeedUser.email },
    });

    expect(backfilled.name).toBe(firstSeedUser.email.split('@')[0]);
  });

  it('seeds exactly one credential account per user, verifiable against the seed password', async () => {
    await seedDatabase(prisma);
    const seedPassword = getSeedUserPassword();

    for (const { email } of SEED_USERS) {
      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      const credentialAccounts = await prisma.account.findMany({
        where: { userId: user.id, providerId: CREDENTIAL_PROVIDER_ID },
      });

      expect(credentialAccounts).toHaveLength(1);
      const [credentialAccount] = credentialAccounts;
      if (!credentialAccount?.password) {
        throw new Error(`no credential account password found for ${email}`);
      }
      expect(credentialAccount.accountId).toBe(user.id);

      const verified = await verify(credentialAccount.password, seedPassword);
      expect(verified).toBe(true);
    }
  });

  it('refuses to run when NODE_ENV=production', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    try {
      await expect(seedDatabase(prisma)).rejects.toThrow(/production/);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('is idempotent: running the seed again does not duplicate or update seed users', async () => {
    const [firstSeedUser] = SEED_USERS;
    if (!firstSeedUser) {
      throw new Error('SEED_USERS is empty');
    }

    await seedDatabase(prisma);
    const before = await prisma.user.findUniqueOrThrow({
      where: { email: firstSeedUser.email },
    });

    await seedDatabase(prisma);
    const after = await prisma.user.findUniqueOrThrow({
      where: { email: firstSeedUser.email },
    });

    expect(after.updatedAt).toEqual(before.updatedAt);
    const seedUserCount = await prisma.user.count({
      where: { email: { in: SEED_USERS.map((seedUser) => seedUser.email) } },
    });
    expect(seedUserCount).toBe(SEED_USERS.length);
  });
});
