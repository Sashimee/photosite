import 'dotenv/config';
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
  await seedCountry(prisma);
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
