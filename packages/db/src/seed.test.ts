import { verify } from '@node-rs/argon2';
import { ADMIN_PERMISSIONS } from '@photoo/shared';
import { decryptAesGcm } from '@photoo/shared/crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import {
  CREDENTIAL_PROVIDER_ID,
  DEV_VERIFICATION_ENCRYPTION_KEY,
  LUXEMBOURG_REQUIRED_DOCUMENTS,
  SEED_ADMIN_EMAIL,
  SEED_BOOKING_CLIENT_EMAIL,
  SEED_BOOKING_PHOTOGRAPHER_SLUG,
  SEED_UNVERIFIED_PHOTOGRAPHER_EMAIL,
  SEED_USERS,
  SEED_VERIFICATION_BUSINESS_NAME,
  SEED_VERIFICATION_BUSINESS_REGISTRATION_NUMBER,
  SEED_VERIFICATION_VAT_NUMBER,
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

  it('grants the seeded admin every admin permission, self-granted', async () => {
    await seedDatabase(prisma);

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: SEED_ADMIN_EMAIL } });
    const grants = await prisma.adminPermissionGrant.findMany({ where: { userId: admin.id } });

    expect(grants.map((grant) => grant.permission).sort()).toEqual([...ADMIN_PERMISSIONS].sort());
    expect(grants.every((grant) => grant.grantedByAdminId === admin.id)).toBe(true);
  });

  it('is idempotent: running the seed again does not duplicate admin permission grants', async () => {
    await seedDatabase(prisma);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: SEED_ADMIN_EMAIL } });
    const before = await prisma.adminPermissionGrant.findMany({ where: { userId: admin.id } });

    await seedDatabase(prisma);
    const after = await prisma.adminPermissionGrant.findMany({ where: { userId: admin.id } });

    expect(after).toHaveLength(before.length);
    expect(after.map((grant) => grant.grantedAt)).toEqual(before.map((grant) => grant.grantedAt));
  });

  it('seeds a submitted verification case with encrypted business fields, not plaintext', async () => {
    await seedDatabase(prisma);

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: SEED_UNVERIFIED_PHOTOGRAPHER_EMAIL },
    });
    const verificationCase = await prisma.verificationCase.findFirstOrThrow({
      where: { userId: user.id },
    });

    expect(verificationCase.status).toBe('submitted');
    expect(verificationCase.businessName).not.toBe(SEED_VERIFICATION_BUSINESS_NAME);
    expect(verificationCase.vatNumber).not.toBe(SEED_VERIFICATION_VAT_NUMBER);
    expect(verificationCase.businessRegistrationNumber).not.toBe(
      SEED_VERIFICATION_BUSINESS_REGISTRATION_NUMBER,
    );
    expect(verificationCase.businessName).not.toContain(SEED_VERIFICATION_BUSINESS_NAME);

    const key = Buffer.from(DEV_VERIFICATION_ENCRYPTION_KEY, 'base64');
    expect(decryptAesGcm(verificationCase.businessName ?? '', key)).toBe(
      SEED_VERIFICATION_BUSINESS_NAME,
    );
    expect(decryptAesGcm(verificationCase.vatNumber ?? '', key)).toBe(SEED_VERIFICATION_VAT_NUMBER);
    expect(decryptAesGcm(verificationCase.businessRegistrationNumber ?? '', key)).toBe(
      SEED_VERIFICATION_BUSINESS_REGISTRATION_NUMBER,
    );

    const documents = await prisma.verificationDocument.findMany({
      where: { caseId: verificationCase.id },
    });
    expect(documents).toHaveLength(LUXEMBOURG_REQUIRED_DOCUMENTS.length);
  });

  it('seeds a released, paid booking with a delivery and a balanced ledger', async () => {
    await seedDatabase(prisma);

    const client = await prisma.user.findUniqueOrThrow({
      where: { email: SEED_BOOKING_CLIENT_EMAIL },
    });
    const photographer = await prisma.photographerProfile.findUniqueOrThrow({
      where: { slug: SEED_BOOKING_PHOTOGRAPHER_SLUG },
    });

    const booking = await prisma.booking.findFirstOrThrow({
      where: { clientId: client.id, photographerId: photographer.id },
      include: { quote: true, delivery: true, ledgerEntries: true },
    });

    expect(booking.status).toBe('released');
    expect(booking.paymentIntentId).not.toBeNull();
    expect(booking.chargeId).not.toBeNull();
    expect(booking.transferId).not.toBeNull();
    expect(booking.deliveredAt).not.toBeNull();
    expect(booking.releasedAt).not.toBeNull();

    expect(booking.delivery).not.toBeNull();
    expect(booking.delivery?.acceptedAt).not.toBeNull();

    expect(booking.ledgerEntries).toHaveLength(3);
    const charge = booking.ledgerEntries.find((entry) => entry.type === 'charge');
    const platformFee = booking.ledgerEntries.find((entry) => entry.type === 'platform_fee');
    const transfer = booking.ledgerEntries.find((entry) => entry.type === 'transfer');
    if (!charge || !platformFee || !transfer) {
      throw new Error('expected a charge, platform_fee and transfer ledger entry');
    }

    // The ledger balances: what the client was charged equals what the
    // photographer is paid plus the platform's cut.
    expect(charge.amountCents).toBe(booking.quote.totalCents);
    expect(platformFee.amountCents).toBe(booking.quote.platformFeeCents);
    expect(transfer.amountCents).toBe(charge.amountCents - platformFee.amountCents);
  });

  it('is idempotent: running the seed again does not duplicate the paid booking or its ledger', async () => {
    await seedDatabase(prisma);
    const client = await prisma.user.findUniqueOrThrow({
      where: { email: SEED_BOOKING_CLIENT_EMAIL },
    });
    const photographer = await prisma.photographerProfile.findUniqueOrThrow({
      where: { slug: SEED_BOOKING_PHOTOGRAPHER_SLUG },
    });
    const before = await prisma.booking.findFirstOrThrow({
      where: { clientId: client.id, photographerId: photographer.id },
    });

    await seedDatabase(prisma);

    const bookingCount = await prisma.booking.count({
      where: { clientId: client.id, photographerId: photographer.id },
    });
    const after = await prisma.booking.findFirstOrThrow({ where: { id: before.id } });
    const ledgerCount = await prisma.ledgerEntry.count({ where: { bookingId: before.id } });
    const deliveryCount = await prisma.delivery.count({ where: { bookingId: before.id } });

    expect(bookingCount).toBe(1);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(ledgerCount).toBe(3);
    expect(deliveryCount).toBe(1);
  });
});
