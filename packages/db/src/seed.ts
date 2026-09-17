import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from '@node-rs/argon2';
import { quoteTotals, type UserRole } from '@photoo/shared';
import { createS3Client, putPublicObject } from '@photoo/shared/storage';
import { createPrismaClient, type LicenceUsage, type PhotographerCategory } from './index.js';

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

// Better Auth requires `User.name`; seed users get it from the email local
// part, matching the default new sign-ups get (DATA-MODEL.md).
function nameFromEmail(email: string): string {
  const [localPart] = email.split('@');
  if (!localPart) {
    throw new Error(`db seed: cannot derive a name from email "${email}"`);
  }
  return localPart;
}

async function seedUser(
  prisma: ReturnType<typeof createPrismaClient>,
  email: string,
  roles: readonly UserRole[],
): Promise<{ id: string }> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.name === null) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { name: nameFromEmail(email) },
      });
    }
    return existing;
  }
  return prisma.user.create({
    data: {
      email,
      emailVerifiedAt: new Date(),
      name: nameFromEmail(email),
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

interface SeedProductTierSpec {
  usage: LicenceUsage;
  priceCents: number;
}

const TIER_USAGE_DESCRIPTIONS: Record<LicenceUsage, string> = {
  personal: 'For personal, non-commercial use only.',
  commercial: 'Licensed for commercial and marketing use.',
  editorial: 'Licensed for editorial and press use.',
  extended: 'Extended licence covering large-scale and resale use.',
};

interface SeedProductSpec {
  title: string;
  category: PhotographerCategory;
  durationMinutes: number;
  basePriceCents: number;
  deliverables: Record<string, string | number | boolean>;
  tiers: readonly SeedProductTierSpec[];
}

interface SeedPortfolioImageSpec {
  order: number;
  width: number;
  height: number;
}

export interface SeedPhotographerProfileSpec {
  email: string;
  slug: string;
  displayName: string;
  headline: string;
  bio: string;
  city: string;
  lat: number;
  lng: number;
  serviceRadiusKm: number;
  categories: readonly PhotographerCategory[];
  languages: readonly string[];
  products: readonly SeedProductSpec[];
  portfolioImages: readonly SeedPortfolioImageSpec[];
}

// Luxembourg City, Esch-sur-Alzette and Ettelbruck: one demo, published and
// verified profile per city so search (1A.4b) has real spread to query
// against. Real profiles cannot reach `isPublished` this way; see
// docs/steps/1A.4-profiles-products.md.
export const SEED_PHOTOGRAPHER_PROFILES: readonly SeedPhotographerProfileSpec[] = [
  {
    email: 'sofia.martins@photoo.test',
    slug: 'sofia-martins',
    displayName: 'Sofia Martins',
    headline: 'Wedding and portrait photographer in Luxembourg City',
    bio: 'Documentary-style wedding and portrait photography across Luxembourg City and the surrounding communes.',
    city: 'Luxembourg City',
    lat: 49.6116,
    lng: 6.1319,
    serviceRadiusKm: 30,
    categories: ['wedding', 'portrait'],
    languages: ['fr', 'en', 'pt'],
    products: [
      {
        title: 'Wedding day coverage',
        category: 'wedding',
        durationMinutes: 480,
        basePriceCents: 250000,
        deliverables: { photos: 400, editedPhotos: 150, turnaroundDays: 21, onlineGallery: true },
        tiers: [
          { usage: 'personal', priceCents: 250000 },
          { usage: 'commercial', priceCents: 400000 },
        ],
      },
      {
        title: 'Portrait session',
        category: 'portrait',
        durationMinutes: 60,
        basePriceCents: 15000,
        deliverables: { photos: 40, editedPhotos: 15, turnaroundDays: 7, onlineGallery: true },
        tiers: [
          { usage: 'personal', priceCents: 15000 },
          { usage: 'extended', priceCents: 30000 },
        ],
      },
    ],
    portfolioImages: [
      { order: 1, width: 2560, height: 1707 },
      { order: 2, width: 2560, height: 1707 },
      { order: 3, width: 1707, height: 2560 },
    ],
  },
  {
    email: 'karim.diallo@photoo.test',
    slug: 'karim-diallo',
    displayName: 'Karim Diallo',
    headline: 'Event and corporate photographer in Esch-sur-Alzette',
    bio: 'Corporate events, conferences and headshots for companies across the south of Luxembourg.',
    city: 'Esch-sur-Alzette',
    lat: 49.4958,
    lng: 5.9806,
    serviceRadiusKm: 25,
    categories: ['event', 'corporate'],
    languages: ['fr', 'de', 'en'],
    products: [
      {
        title: 'Corporate event coverage',
        category: 'event',
        durationMinutes: 240,
        basePriceCents: 60000,
        deliverables: { photos: 200, editedPhotos: 80, turnaroundDays: 10, onlineGallery: true },
        tiers: [
          { usage: 'commercial', priceCents: 90000 },
          { usage: 'editorial', priceCents: 70000 },
        ],
      },
      {
        title: 'Corporate headshot session',
        category: 'corporate',
        durationMinutes: 30,
        basePriceCents: 12000,
        deliverables: { photos: 15, editedPhotos: 5, turnaroundDays: 5, onlineGallery: true },
        tiers: [
          { usage: 'personal', priceCents: 12000 },
          { usage: 'commercial', priceCents: 20000 },
        ],
      },
    ],
    portfolioImages: [
      { order: 1, width: 2560, height: 1707 },
      { order: 2, width: 2560, height: 1707 },
      { order: 3, width: 2560, height: 1707 },
    ],
  },
  {
    email: 'lena.weber@photoo.test',
    slug: 'lena-weber',
    displayName: 'Lena Weber',
    headline: 'Real estate and product photographer in Ettelbruck',
    bio: 'Real estate and product photography for agencies and small businesses in the north of Luxembourg.',
    city: 'Ettelbruck',
    lat: 49.8479,
    lng: 6.1044,
    serviceRadiusKm: 35,
    categories: ['real_estate', 'product'],
    languages: ['de', 'fr', 'en'],
    products: [
      {
        title: 'Real estate photography',
        category: 'real_estate',
        durationMinutes: 90,
        basePriceCents: 20000,
        deliverables: { photos: 30, editedPhotos: 25, turnaroundDays: 3, onlineGallery: true },
        tiers: [
          { usage: 'commercial', priceCents: 20000 },
          { usage: 'extended', priceCents: 35000 },
        ],
      },
      {
        title: 'Product photography',
        category: 'product',
        durationMinutes: 120,
        basePriceCents: 30000,
        deliverables: { photos: 25, editedPhotos: 25, turnaroundDays: 5, onlineGallery: true },
        tiers: [
          { usage: 'commercial', priceCents: 30000 },
          { usage: 'editorial', priceCents: 25000 },
        ],
      },
    ],
    portfolioImages: [
      { order: 1, width: 2560, height: 1707 },
      { order: 2, width: 2560, height: 1707 },
      { order: 3, width: 2560, height: 1707 },
    ],
  },
];

// Matches the `${name}_${format}` shape the worker's image-process job
// writes to `Upload.variants` (apps/worker/src/queues/processors/image-process.processor.ts).
function placeholderVariants(prefix: string): Record<string, string> {
  const variants: Record<string, string> = {};
  for (const name of ['thumb', 'medium', 'large']) {
    for (const [format, extension] of [
      ['jpeg', 'jpg'],
      ['webp', 'webp'],
    ] as const) {
      variants[`${name}_${format}`] = `v/${prefix}/${name}.${extension}`;
    }
  }
  return variants;
}

const PLACEHOLDER_IMAGE_PATH = join(import.meta.dirname, '../assets/placeholder.jpg');

interface SeedStorage {
  client: ReturnType<typeof createS3Client>;
  bucket: string;
}

// Kept optional so CI can run `pnpm db:seed` without MinIO reachable: without
// every S3_* var set, seedPhotographerProfile still creates Upload rows
// pointing at variant keys, just with no backing object in MinIO.
function seedStorageFromEnv(): SeedStorage | null {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const publicBucket = process.env.S3_PUBLIC_BUCKET;
  if (!endpoint || !region || !accessKeyId || !secretAccessKey || !publicBucket) {
    console.log('db seed: S3 env vars not set, skipping placeholder image uploads');
    return null;
  }
  return {
    client: createS3Client({
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      privateBucket: process.env.S3_PRIVATE_BUCKET ?? publicBucket,
      publicBucket,
    }),
    bucket: publicBucket,
  };
}

async function uploadPlaceholderVariants(
  storage: SeedStorage | null,
  variants: Record<string, string>,
): Promise<void> {
  if (!storage) {
    return;
  }
  const body = readFileSync(PLACEHOLDER_IMAGE_PATH);
  for (const key of Object.values(variants)) {
    const contentType = key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    await putPublicObject(storage.client, storage.bucket, key, body, contentType);
  }
}

// Demo profiles are seeded published and verified directly: real profiles
// cannot reach that state before 1A.8 (verification) and 1A.9 (Stripe
// Connect) land (docs/steps/1A.4-profiles-products.md). Idempotent: skips
// entirely once the profile exists, so it never duplicates or updates
// products, tiers or portfolio images on a second run. `location` is set
// with a raw query since it is an `Unsupported` Prisma type.
export async function seedPhotographerProfile(
  prisma: ReturnType<typeof createPrismaClient>,
  spec: SeedPhotographerProfileSpec,
  passwordHash: string,
  storage: SeedStorage | null,
): Promise<void> {
  const user = await seedUser(prisma, spec.email, ['photographer']);
  await seedCredentialAccount(prisma, user.id, passwordHash);

  const existingProfile = await prisma.photographerProfile.findUnique({
    where: { userId: user.id },
  });
  if (existingProfile) {
    return;
  }

  const avatarVariants = placeholderVariants(`seed/${spec.slug}/avatar`);
  const avatarUpload = await prisma.upload.create({
    data: {
      ownerId: user.id,
      purpose: 'avatar',
      status: 'processed',
      mimeType: 'image/jpeg',
      declaredSizeBytes: 2048,
      actualSizeBytes: 2048,
      width: 512,
      height: 512,
      objectKey: `seed/${spec.slug}/avatar/original.jpg`,
      variants: avatarVariants,
      virusScanStatus: 'clean',
    },
  });
  await uploadPlaceholderVariants(storage, avatarVariants);

  const coverVariants = placeholderVariants(`seed/${spec.slug}/cover`);
  const coverUpload = await prisma.upload.create({
    data: {
      ownerId: user.id,
      purpose: 'cover',
      status: 'processed',
      mimeType: 'image/jpeg',
      declaredSizeBytes: 4096,
      actualSizeBytes: 4096,
      width: 2560,
      height: 853,
      objectKey: `seed/${spec.slug}/cover/original.jpg`,
      variants: coverVariants,
      virusScanStatus: 'clean',
    },
  });
  await uploadPlaceholderVariants(storage, coverVariants);

  const profile = await prisma.photographerProfile.create({
    data: {
      userId: user.id,
      slug: spec.slug,
      displayName: spec.displayName,
      headline: spec.headline,
      bio: { en: spec.bio },
      avatarUploadId: avatarUpload.id,
      coverUploadId: coverUpload.id,
      links: { instagram: null, website: null, behance: null, other: [] },
      categories: [...spec.categories],
      languages: [...spec.languages],
      serviceRadiusKm: spec.serviceRadiusKm,
      city: spec.city,
      countryCode: 'LU',
      verificationStatus: 'verified',
      stripeAccountId: `acct_seed_${spec.slug}`,
      stripeOnboardingComplete: true,
      stripePayoutsEnabled: true,
      ratingAvg: 4.8,
      ratingCount: 12,
      isPublished: true,
    },
  });

  await prisma.$executeRaw`
    UPDATE "PhotographerProfile"
    SET location = ST_SetSRID(ST_MakePoint(${spec.lng}, ${spec.lat}), 4326)::geography
    WHERE id = ${profile.id}
  `;

  for (const image of spec.portfolioImages) {
    const portfolioVariants = placeholderVariants(
      `seed/${spec.slug}/portfolio-${String(image.order)}`,
    );
    const upload = await prisma.upload.create({
      data: {
        ownerId: user.id,
        purpose: 'portfolio',
        status: 'processed',
        mimeType: 'image/jpeg',
        declaredSizeBytes: 8192,
        actualSizeBytes: 8192,
        width: image.width,
        height: image.height,
        objectKey: `seed/${spec.slug}/portfolio-${String(image.order)}/original.jpg`,
        variants: portfolioVariants,
        virusScanStatus: 'clean',
      },
    });
    await uploadPlaceholderVariants(storage, portfolioVariants);
    await prisma.portfolioImage.create({
      data: {
        profileId: profile.id,
        uploadId: upload.id,
        width: image.width,
        height: image.height,
        order: image.order,
        status: 'approved',
      },
    });
  }

  for (const [index, product] of spec.products.entries()) {
    const createdProduct = await prisma.product.create({
      data: {
        profileId: profile.id,
        title: { en: product.title },
        category: product.category,
        durationMinutes: product.durationMinutes,
        deliverables: product.deliverables,
        basePriceCents: product.basePriceCents,
        currency: 'EUR',
        isActive: true,
        order: index + 1,
      },
    });
    for (const tier of product.tiers) {
      await prisma.productTier.create({
        data: {
          productId: createdProduct.id,
          usage: tier.usage,
          priceCents: tier.priceCents,
          currency: 'EUR',
          description: TIER_USAGE_DESCRIPTIONS[tier.usage],
          licenceTextVersion: 'v1',
        },
      });
    }
  }
}

async function seedPhotographerProfiles(
  prisma: ReturnType<typeof createPrismaClient>,
): Promise<void> {
  const passwordHash = await hash(getSeedUserPassword());
  const storage = seedStorageFromEnv();
  for (const spec of SEED_PHOTOGRAPHER_PROFILES) {
    await seedPhotographerProfile(prisma, spec, passwordHash, storage);
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

export const SEED_REQUEST_CLIENT_EMAIL = 'client@photoo.test';
export const SEED_REQUEST_PHOTOGRAPHER_SLUG = 'sofia-martins';
export const SEED_REQUEST_TITLE = 'Wedding day coverage in Luxembourg City';

const SEED_REQUEST_LOCATION = { lat: 49.6116, lng: 6.1319 };

// One open request from the seeded client, quoted by one seeded demo
// photographer, so 1A.5b's integration tests have a real request/quote pair
// to read without creating their own fixtures. Idempotent: keyed on
// (clientId, title), which nothing else in the seed produces twice.
// `feePercent` and the line item price come from PlatformSetting and the
// photographer's own seeded product, never hardcoded totals, so this stays
// correct if either changes.
export async function seedRequestAndQuote(
  prisma: ReturnType<typeof createPrismaClient>,
): Promise<void> {
  const client = await prisma.user.findUniqueOrThrow({
    where: { email: SEED_REQUEST_CLIENT_EMAIL },
  });
  const photographer = await prisma.photographerProfile.findUniqueOrThrow({
    where: { slug: SEED_REQUEST_PHOTOGRAPHER_SLUG },
    include: { products: { include: { tiers: true } } },
  });

  const existingRequest = await prisma.request.findFirst({
    where: { clientId: client.id, title: SEED_REQUEST_TITLE },
  });
  if (existingRequest) {
    return;
  }

  const eventDate = new Date();
  eventDate.setUTCDate(eventDate.getUTCDate() + 90);
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 60);

  const request = await prisma.request.create({
    data: {
      clientId: client.id,
      title: SEED_REQUEST_TITLE,
      category: 'wedding',
      description: 'Looking for full-day wedding coverage in Luxembourg City.',
      eventDate,
      dateFlexible: false,
      address: { street: '1 Place Guillaume II', city: 'Luxembourg City', postalCode: 'L-1648' },
      city: 'Luxembourg City',
      countryCode: 'LU',
      budgetMinCents: 200000,
      budgetMaxCents: 400000,
      currency: 'EUR',
      usage: 'personal',
      status: 'open',
      expiresAt,
    },
  });

  await prisma.$executeRaw`
    UPDATE "Request"
    SET location = ST_SetSRID(ST_MakePoint(${SEED_REQUEST_LOCATION.lng}, ${SEED_REQUEST_LOCATION.lat}), 4326)::geography
    WHERE id = ${request.id}
  `;

  const weddingProduct = photographer.products.find((product) =>
    product.tiers.some((tier) => tier.usage === 'personal'),
  );
  const weddingTier = weddingProduct?.tiers.find((tier) => tier.usage === 'personal');
  if (!weddingProduct || !weddingTier) {
    throw new Error(
      `db seed: no personal-usage product tier found for photographer "${SEED_REQUEST_PHOTOGRAPHER_SLUG}"`,
    );
  }

  const feePercentSetting = await prisma.platformSetting.findUniqueOrThrow({
    where: { key: 'feePercent' },
  });
  const feePercent = feePercentSetting.value as number;

  const productTitle = (weddingProduct.title as { en: string }).en;
  const lineItems = [{ label: productTitle, qty: 1, unitCents: weddingTier.priceCents }];
  const totals = quoteTotals(lineItems, feePercent);

  const validUntil = new Date();
  validUntil.setUTCDate(validUntil.getUTCDate() + 7);

  await prisma.quote.create({
    data: {
      requestId: request.id,
      photographerId: photographer.id,
      clientId: client.id,
      lineItems,
      subtotalCents: totals.subtotalCents,
      platformFeeCents: totals.platformFeeCents,
      totalCents: totals.totalCents,
      feePercent,
      licenceUsage: request.usage,
      currency: 'EUR',
      validUntil,
      status: 'sent',
    },
  });
}

// One `quote` conversation for the seeded request/quote, between the
// seeded client and the photographer's user, with two messages, so 1A.6b's
// integration tests have a real conversation to read without creating their
// own fixtures. Idempotent on `(type, subjectId)`, the same unique index
// that makes `QuotesService` idempotent when it creates this conversation
// in the quote's transaction (docs/steps/1A.6-chat.md).
export async function seedQuoteConversation(
  prisma: ReturnType<typeof createPrismaClient>,
): Promise<void> {
  const client = await prisma.user.findUniqueOrThrow({
    where: { email: SEED_REQUEST_CLIENT_EMAIL },
  });
  const photographer = await prisma.photographerProfile.findUniqueOrThrow({
    where: { slug: SEED_REQUEST_PHOTOGRAPHER_SLUG },
  });
  const quote = await prisma.quote.findFirstOrThrow({
    where: { clientId: client.id, photographerId: photographer.id },
  });

  const existingConversation = await prisma.conversation.findUnique({
    where: { type_subjectId: { type: 'quote', subjectId: quote.id } },
  });
  if (existingConversation) {
    return;
  }

  const conversation = await prisma.conversation.create({
    data: {
      type: 'quote',
      subjectId: quote.id,
      participants: {
        create: [{ userId: client.id }, { userId: photographer.userId }],
      },
    },
  });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: client.id,
      body: 'Hi! Thanks for the quote, does the price include travel to the ceremony venue?',
    },
  });
  const secondMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: photographer.userId,
      body: 'Yes, travel within Luxembourg City is included. Let me know if you have any other questions.',
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: secondMessage.createdAt },
  });
}

export async function seedDatabase(prisma: ReturnType<typeof createPrismaClient>): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db seed: refusing to run with NODE_ENV=production');
  }
  await seedCountry(prisma);
  await seedUsers(prisma);
  await seedPhotographerProfiles(prisma);
  await seedPlatformSetting(prisma, 'feePercent', 5);
  await seedPlatformSetting(prisma, 'autoReleaseDays', 7);
  await seedRequestAndQuote(prisma);
  await seedQuoteConversation(prisma);
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
