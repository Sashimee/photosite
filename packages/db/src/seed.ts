import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import type { UserRole } from '@photoo/shared';
import { createPrismaClient } from './index.js';

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy packages/db/.env.example to packages/db/.env and set it.',
    );
  }
  return url;
}

const ACCEPTED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export const LUXEMBOURG_REQUIRED_DOCUMENTS = [
  {
    key: 'autorisation_etablissement',
    label: { en: "Business establishment authorization (autorisation d'établissement)" },
    description: {
      en: "Luxembourg permit required to operate a commercial activity ('autorisation d'établissement').",
    },
    acceptedMimeTypes: ACCEPTED_DOCUMENT_MIME_TYPES,
  },
  {
    key: 'vat_number',
    label: { en: 'VAT (TVA) registration certificate' },
    description: { en: 'Proof of Luxembourg VAT (TVA) registration number.' },
    acceptedMimeTypes: ACCEPTED_DOCUMENT_MIME_TYPES,
  },
  {
    key: 'id_document',
    label: { en: 'Government-issued ID document' },
    description: { en: 'Passport or national ID card of the account holder.' },
    acceptedMimeTypes: ACCEPTED_DOCUMENT_MIME_TYPES,
  },
  {
    key: 'proof_of_address',
    label: { en: 'Proof of address' },
    description: { en: 'A utility bill or bank statement issued within the last 3 months.' },
    acceptedMimeTypes: ACCEPTED_DOCUMENT_MIME_TYPES,
  },
];

async function seedCountry(prisma: ReturnType<typeof createPrismaClient>): Promise<void> {
  const existing = await prisma.country.findUnique({ where: { code: 'LU' } });
  if (existing) {
    return;
  }
  await prisma.country.create({
    data: {
      code: 'LU',
      name: 'Luxembourg',
      enabled: true,
      currency: 'EUR',
      vatRate: 17,
      requiredDocuments: LUXEMBOURG_REQUIRED_DOCUMENTS,
      legalTexts: {},
      defaultLocale: 'fr',
    },
  });
}

const DEFAULT_SEED_USER_PASSWORD = 'correct-horse-battery-staple';

export const SEED_USERS: readonly { email: string; roles: readonly UserRole[] }[] = [
  { email: 'client@photoo.test', roles: ['client'] },
  { email: 'photographer@photoo.test', roles: ['photographer'] },
  { email: 'professional@photoo.test', roles: ['professional'] },
  { email: 'admin@photoo.test', roles: ['admin'] },
];

export function getSeedUserPassword(): string {
  return process.env.SEED_USER_PASSWORD ?? DEFAULT_SEED_USER_PASSWORD;
}

// Better Auth verifies email+password logins against the credential Account
// row (D20), so the Argon2id hash lives on `Account.password`, not on User.
export const CREDENTIAL_PROVIDER_ID = 'credential';

async function seedUser(
  prisma: ReturnType<typeof createPrismaClient>,
  email: string,
  roles: readonly UserRole[],
): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return existing;
  }
  return prisma.user.create({
    data: {
      email,
      emailVerifiedAt: new Date(),
      locale: 'en',
      countryCode: 'LU',
      roles: [...roles],
      status: 'active',
      twoFactorEnabled: false,
    },
  });
}

async function seedCredentialAccount(
  prisma: ReturnType<typeof createPrismaClient>,
  userId: string,
  passwordHash: string,
): Promise<void> {
  const existing = await prisma.account.findUnique({
    where: {
      providerId_accountId: { providerId: CREDENTIAL_PROVIDER_ID, accountId: userId },
    },
  });
  if (existing) {
    return;
  }
  await prisma.account.create({
    data: {
      userId,
      providerId: CREDENTIAL_PROVIDER_ID,
      accountId: userId,
      password: passwordHash,
    },
  });
}

// Admins need TOTP enrolment (1A.2, Better Auth two-factor plugin) before
// admin login is usable per SECURITY.md's mandatory-2FA rule.
async function seedUsers(prisma: ReturnType<typeof createPrismaClient>): Promise<void> {
  const passwordHash = await hash(getSeedUserPassword());
  for (const { email, roles } of SEED_USERS) {
    const user = await seedUser(prisma, email, roles);
    await seedCredentialAccount(prisma, user.id, passwordHash);
  }
}

async function seedPlatformSetting(
  prisma: ReturnType<typeof createPrismaClient>,
  key: string,
  value: number,
): Promise<void> {
  const existing = await prisma.platformSetting.findUnique({ where: { key } });
  if (existing) {
    return;
  }
  await prisma.platformSetting.create({
    data: {
      key,
      value,
      updatedByAdminId: null,
    },
  });
}

export async function seedDatabase(prisma: ReturnType<typeof createPrismaClient>): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db seed: refusing to run with NODE_ENV=production');
  }
  await seedCountry(prisma);
  await seedUsers(prisma);
  await seedPlatformSetting(prisma, 'feePercent', 5);
  await seedPlatformSetting(prisma, 'autoReleaseDays', 7);
}

async function main(): Promise<void> {
  const prisma = createPrismaClient(getDatabaseUrl());
  try {
    await seedDatabase(prisma);
    console.log('db seed: done');
  } finally {
    await prisma.$disconnect();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === `file://${invokedPath}`) {
  await main();
}
