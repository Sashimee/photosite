import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { hash } from '@node-rs/argon2';
import { ADMIN_PERMISSIONS, quoteTotals, type UserRole } from '@photoo/shared';
import { encryptAesGcm } from '@photoo/shared/crypto';
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

// `label` is `LocalizedTextSchema`, but `description` on `RequiredDocumentSchema`
// (packages/shared/src/contract/verification.ts) is a plain nullable string,
// not localized text.
export const LUXEMBOURG_REQUIRED_DOCUMENTS = [
  {
    key: 'autorisation_etablissement',
    label: { en: "Business establishment authorization (autorisation d'établissement)" },
    description:
      "Luxembourg permit required to operate a commercial activity ('autorisation d'établissement').",
    acceptedMimeTypes: ACCEPTED_DOCUMENT_MIME_TYPES,
  },
  {
    key: 'vat_number',
    label: { en: 'VAT (TVA) registration certificate' },
    description: 'Proof of Luxembourg VAT (TVA) registration number.',
    acceptedMimeTypes: ACCEPTED_DOCUMENT_MIME_TYPES,
  },
  {
    key: 'id_document',
    label: { en: 'Government-issued ID document' },
    description: 'Passport or national ID card of the account holder.',
    acceptedMimeTypes: ACCEPTED_DOCUMENT_MIME_TYPES,
  },
  {
    key: 'proof_of_address',
    label: { en: 'Proof of address' },
    description: 'A utility bill or bank statement issued within the last 3 months.',
    acceptedMimeTypes: ACCEPTED_DOCUMENT_MIME_TYPES,
  },
];

// Backfills `requiredDocuments` on an existing row so a DB seeded before its
// `description` field matched `RequiredDocumentSchema` (a plain string, not
// localized text) gets corrected on the next seed run.
async function seedCountry(prisma: ReturnType<typeof createPrismaClient>): Promise<void> {
  const existing = await prisma.country.findUnique({ where: { code: 'LU' } });
  if (existing) {
    if (!isDeepStrictEqual(existing.requiredDocuments, LUXEMBOURG_REQUIRED_DOCUMENTS)) {
      await prisma.country.update({
        where: { code: 'LU' },
        data: { requiredDocuments: LUXEMBOURG_REQUIRED_DOCUMENTS },
      });
    }
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

// `seedDatabase`'s production guard below means this fallback can only ever
// be used outside production.
export const DEV_VERIFICATION_ENCRYPTION_KEY = '9DsORuh9HI1DUnXKM0DKVcgw36Y9NfbLBSlfPmQxwYs=';

function getVerificationEncryptionKey(): Buffer {
  const encoded = process.env.VERIFICATION_ENCRYPTION_KEY;
  if (!encoded) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'db seed: VERIFICATION_ENCRYPTION_KEY is not set. Copy packages/db/.env.example to packages/db/.env and set it.',
      );
    }
    return Buffer.from(DEV_VERIFICATION_ENCRYPTION_KEY, 'base64');
  }
  return Buffer.from(encoded, 'base64');
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

export const SEED_ADMIN_EMAIL = 'admin@photoo.test';

// The seeded admin gets every permission so local development and the
// preview environment can exercise every `/admin` route. This is a
// local/preview-only convenience: `seedDatabase`'s production guard above
// means this can never run in production. There is deliberately no API
// endpoint that can grant the first `superadmin` permission
// (docs/steps/1A.11-admin-api.md); the production superadmin is created by
// a one-off script after the first deploy instead (docs/steps/human-followups.md).
// Self-referential `grantedByAdminId` (the admin granting themselves every
// permission) is only possible here because this runs outside the API's
// `requirePermission` checks, which forbid an admin granting their own.
async function seedAdminPermissions(prisma: ReturnType<typeof createPrismaClient>): Promise<void> {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: SEED_ADMIN_EMAIL } });
  for (const permission of ADMIN_PERMISSIONS) {
    await prisma.adminPermissionGrant.upsert({
      where: { userId_permission: { userId: admin.id, permission } },
      create: {
        userId: admin.id,
        permission,
        grantedByAdminId: admin.id,
      },
      update: {},
    });
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

  const avatarObjectKey = `seed/${spec.slug}/avatar/original.jpg`;
  const avatarVariants = placeholderVariants(`seed/${spec.slug}/avatar`);
  const avatarUpload = await prisma.upload.upsert({
    where: { objectKey: avatarObjectKey },
    create: {
      ownerId: user.id,
      purpose: 'avatar',
      status: 'processed',
      mimeType: 'image/jpeg',
      declaredSizeBytes: 2048,
      actualSizeBytes: 2048,
      width: 512,
      height: 512,
      objectKey: avatarObjectKey,
      variants: avatarVariants,
      virusScanStatus: 'clean',
    },
    update: {},
  });
  await uploadPlaceholderVariants(storage, avatarVariants);

  const coverObjectKey = `seed/${spec.slug}/cover/original.jpg`;
  const coverVariants = placeholderVariants(`seed/${spec.slug}/cover`);
  const coverUpload = await prisma.upload.upsert({
    where: { objectKey: coverObjectKey },
    create: {
      ownerId: user.id,
      purpose: 'cover',
      status: 'processed',
      mimeType: 'image/jpeg',
      declaredSizeBytes: 4096,
      actualSizeBytes: 4096,
      width: 2560,
      height: 853,
      objectKey: coverObjectKey,
      variants: coverVariants,
      virusScanStatus: 'clean',
    },
    update: {},
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
    const portfolioObjectKey = `seed/${spec.slug}/portfolio-${String(image.order)}/original.jpg`;
    const upload = await prisma.upload.upsert({
      where: { objectKey: portfolioObjectKey },
      create: {
        ownerId: user.id,
        purpose: 'portfolio',
        status: 'processed',
        mimeType: 'image/jpeg',
        declaredSizeBytes: 8192,
        actualSizeBytes: 8192,
        width: image.width,
        height: image.height,
        objectKey: portfolioObjectKey,
        variants: portfolioVariants,
        virusScanStatus: 'clean',
      },
      update: {},
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

export const SEED_UNVERIFIED_PHOTOGRAPHER_EMAIL = 'noor.hassan@photoo.test';
export const SEED_UNVERIFIED_PHOTOGRAPHER_SLUG = 'noor-hassan';

export const SEED_VERIFICATION_BUSINESS_NAME = 'Hassan Photography Sàrl';
export const SEED_VERIFICATION_VAT_NUMBER = 'LU87654321';
export const SEED_VERIFICATION_BUSINESS_REGISTRATION_NUMBER = 'B234567';

// The case's country comes from the photographer profile's countryCode
// (docs/steps/1A.9-verification.md), so this profile exists purely to give
// the seeded case one; it stays unpublished since `pending` verification
// can never satisfy `PublishPolicy.canPublish` (DATA-MODEL.md).
async function seedUnverifiedPhotographerProfile(
  prisma: ReturnType<typeof createPrismaClient>,
  passwordHash: string,
): Promise<{ userId: string; profileId: string }> {
  const user = await seedUser(prisma, SEED_UNVERIFIED_PHOTOGRAPHER_EMAIL, ['photographer']);
  await seedCredentialAccount(prisma, user.id, passwordHash);

  const existingProfile = await prisma.photographerProfile.findUnique({
    where: { userId: user.id },
  });
  if (existingProfile) {
    return { userId: user.id, profileId: existingProfile.id };
  }

  const profile = await prisma.photographerProfile.create({
    data: {
      userId: user.id,
      slug: SEED_UNVERIFIED_PHOTOGRAPHER_SLUG,
      displayName: 'Noor Hassan',
      headline: 'Portrait photographer in Luxembourg City',
      bio: { en: 'New to the platform and awaiting verification.' },
      links: { instagram: null, website: null, behance: null, other: [] },
      categories: ['portrait'],
      languages: ['en'],
      city: 'Luxembourg City',
      countryCode: 'LU',
      verificationStatus: 'pending',
      isPublished: false,
    },
  });

  return { userId: user.id, profileId: profile.id };
}

// Skips entirely once a case exists for the seeded user, same as
// `seedPhotographerProfile`.
export async function seedVerificationCase(
  prisma: ReturnType<typeof createPrismaClient>,
): Promise<void> {
  const passwordHash = await hash(getSeedUserPassword());
  const { userId, profileId } = await seedUnverifiedPhotographerProfile(prisma, passwordHash);

  const existingCase = await prisma.verificationCase.findFirst({ where: { userId } });
  if (existingCase) {
    return;
  }

  const encryptionKey = getVerificationEncryptionKey();

  const verificationCase = await prisma.verificationCase.create({
    data: {
      userId,
      countryCode: 'LU',
      status: 'submitted',
      businessName: encryptAesGcm(SEED_VERIFICATION_BUSINESS_NAME, encryptionKey),
      vatNumber: encryptAesGcm(SEED_VERIFICATION_VAT_NUMBER, encryptionKey),
      businessRegistrationNumber: encryptAesGcm(
        SEED_VERIFICATION_BUSINESS_REGISTRATION_NUMBER,
        encryptionKey,
      ),
      submittedAt: new Date(),
    },
  });

  for (const document of LUXEMBOURG_REQUIRED_DOCUMENTS) {
    const documentObjectKey = `seed/verification/${profileId}/${document.key}.pdf`;
    const upload = await prisma.upload.upsert({
      where: { objectKey: documentObjectKey },
      create: {
        ownerId: userId,
        purpose: 'verification_document',
        status: 'clean',
        mimeType: 'application/pdf',
        declaredSizeBytes: 4096,
        actualSizeBytes: 4096,
        objectKey: documentObjectKey,
        virusScanStatus: 'clean',
      },
      update: {},
    });
    await prisma.verificationDocument.create({
      data: {
        caseId: verificationCase.id,
        documentKey: document.key,
        uploadId: upload.id,
      },
    });
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

const SEED_REQUEST_ADDRESS = {
  line1: '1 Place Guillaume II',
  city: 'Luxembourg City',
  postalCode: 'L-1648',
  countryCode: 'LU',
};

// One open request from the seeded client, quoted by one seeded demo
// photographer, so 1A.5b's integration tests have a real request/quote pair
// to read without creating their own fixtures. Idempotent: keyed on
// (clientId, title), which nothing else in the seed produces twice. Backfills
// `address` on an existing row so a DB seeded before the shape matched
// `AddressSchema` (issue #92) gets corrected on the next seed run.
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
    if (!isDeepStrictEqual(existingRequest.address, SEED_REQUEST_ADDRESS)) {
      await prisma.request.update({
        where: { id: existingRequest.id },
        data: { address: SEED_REQUEST_ADDRESS },
      });
    }
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
      address: SEED_REQUEST_ADDRESS,
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

// A different photographer than `seedRequestAndQuote`'s (`sofia-martins`):
// requests-quotes.test.ts deletes and recounts quotes by (clientId,
// photographerId), and `Booking.quote` is `Restrict`, so a second quote
// booked for that same pair would make its deletes fail.
export const SEED_BOOKING_CLIENT_EMAIL = SEED_REQUEST_CLIENT_EMAIL;
export const SEED_BOOKING_PHOTOGRAPHER_SLUG = 'karim-diallo';
export const SEED_BOOKING_PRODUCT_TITLE = 'Corporate headshot session';

const SEED_BOOKING_LOCATION = SEED_REQUEST_LOCATION;

interface SeedLedgerRow {
  type: 'charge' | 'platform_fee' | 'transfer';
  amountCents: number;
  stripeObjectId: string;
}

// A released, fully paid booking for the seeded client and a second seeded
// product (distinct from `seedRequestAndQuote`'s wedding quote, which stays
// `sent`, relied on by requests-quotes.test.ts), so 1B.7 (web) and 1D.5
// (admin) have a complete booking, delivery and ledger to render without
// creating their own fixtures. Deterministic Stripe-shaped ids (`_seed_` +
// the quote id) stand in for the real ones 1A.8c/d will write. Idempotent:
// the quote is found by its natural key (clientId, photographerId,
// productId, status), never created twice, and the booking/delivery/ledger
// rows are each upserted on their own unique key, so an interrupted run can
// be re-run (#135).
export async function seedPaidBooking(
  prisma: ReturnType<typeof createPrismaClient>,
): Promise<void> {
  const client = await prisma.user.findUniqueOrThrow({
    where: { email: SEED_BOOKING_CLIENT_EMAIL },
  });
  const photographer = await prisma.photographerProfile.findUniqueOrThrow({
    where: { slug: SEED_BOOKING_PHOTOGRAPHER_SLUG },
    include: { products: { include: { tiers: true } } },
  });

  const product = photographer.products.find(
    (candidate) => (candidate.title as { en: string }).en === SEED_BOOKING_PRODUCT_TITLE,
  );
  const tier = product?.tiers.find((candidate) => candidate.usage === 'personal');
  if (!product || !tier) {
    throw new Error(
      `db seed: no personal-usage tier found for product "${SEED_BOOKING_PRODUCT_TITLE}" on photographer "${SEED_BOOKING_PHOTOGRAPHER_SLUG}"`,
    );
  }

  const feePercentSetting = await prisma.platformSetting.findUniqueOrThrow({
    where: { key: 'feePercent' },
  });
  const feePercent = feePercentSetting.value as number;

  let quote = await prisma.quote.findFirst({
    where: {
      clientId: client.id,
      photographerId: photographer.id,
      productId: product.id,
      status: 'accepted',
    },
  });
  if (!quote) {
    const productTitle = (product.title as { en: string }).en;
    const lineItems = [{ label: productTitle, qty: 1, unitCents: tier.priceCents }];
    const totals = quoteTotals(lineItems, feePercent);
    const validUntil = new Date();
    validUntil.setUTCDate(validUntil.getUTCDate() + 7);

    quote = await prisma.quote.create({
      data: {
        photographerId: photographer.id,
        clientId: client.id,
        productId: product.id,
        productTierId: tier.id,
        lineItems,
        subtotalCents: totals.subtotalCents,
        platformFeeCents: totals.platformFeeCents,
        totalCents: totals.totalCents,
        feePercent,
        licenceUsage: tier.usage,
        licenceTextVersion: tier.licenceTextVersion,
        currency: 'EUR',
        validUntil,
        status: 'accepted',
      },
    });
  }

  const scheduledAt = new Date();
  scheduledAt.setUTCDate(scheduledAt.getUTCDate() + 14);
  const deliveredAt = new Date();
  deliveredAt.setUTCDate(deliveredAt.getUTCDate() - 1);
  const releasedAt = new Date();

  const booking = await prisma.booking.upsert({
    where: { quoteId: quote.id },
    create: {
      quoteId: quote.id,
      clientId: client.id,
      photographerId: photographer.id,
      scheduledAt,
      status: 'released',
      paymentIntentId: `pi_seed_${quote.id}`,
      chargeId: `ch_seed_${quote.id}`,
      transferId: `tr_seed_${quote.id}`,
      deliveredAt,
      releasedAt,
    },
    update: {},
  });

  await prisma.$executeRaw`
    UPDATE "Booking"
    SET location = ST_SetSRID(ST_MakePoint(${SEED_BOOKING_LOCATION.lng}, ${SEED_BOOKING_LOCATION.lat}), 4326)::geography
    WHERE id = ${booking.id}
  `;

  await prisma.delivery.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      message: 'Here is your full gallery, thank you for booking!',
      externalLink: 'https://example.com/gallery/seed-booking',
      deliveredAt,
      acceptedAt: releasedAt,
    },
    update: {},
  });

  // Mirrors the release job's ledger writes (docs/PAYMENTS.md): the charge
  // for the full total, the platform's cut, and the transfer to the
  // photographer for the remainder. `stripeObjectId` reuses the booking's
  // own seeded charge/transfer ids since this seed never talks to Stripe.
  const ledgerRows: SeedLedgerRow[] = [
    { type: 'charge', amountCents: quote.totalCents, stripeObjectId: `ch_seed_${quote.id}` },
    {
      type: 'platform_fee',
      amountCents: quote.platformFeeCents,
      stripeObjectId: `tr_seed_${quote.id}`,
    },
    {
      type: 'transfer',
      amountCents: quote.subtotalCents - quote.platformFeeCents,
      stripeObjectId: `tr_seed_${quote.id}`,
    },
  ];
  for (const row of ledgerRows) {
    await prisma.ledgerEntry.upsert({
      where: {
        bookingId_type_stripeObjectId: {
          bookingId: booking.id,
          type: row.type,
          stripeObjectId: row.stripeObjectId,
        },
      },
      create: {
        bookingId: booking.id,
        type: row.type,
        amountCents: row.amountCents,
        currency: 'EUR',
        stripeObjectId: row.stripeObjectId,
      },
      update: {},
    });
  }
}

export const SEED_PROFESSIONAL_EMAIL = 'professional@photoo.test';
export const SEED_PROFESSIONAL_COMPANY_NAME = 'Fondation Kler Sàrl';
export const SEED_JOB_OFFER_SLUG = 'event-photographer-luxembourg-city';
export const SEED_JOB_OFFER_TITLE = 'Event photographer for a corporate gala evening';

const SEED_JOB_OFFER_LOCATION = { lat: 49.6116, lng: 6.1319 };

// One professional profile with a published job offer and its free listing,
// on the seed user already documented as the professional login
// (docs/steps/1A.1-identity-schema.md), so the preview and 1B.9
// (professional area, public job board) have something real to render
// without creating their own fixtures. The offer starts as a draft because
// `Listing.ownerId` needs the offer's id (docs/steps/1A.13-professionals.md:
// "publishing ... creates the listing"), so the listing can't exist first.
// Idempotent: skips entirely once the profile exists, like
// `seedPhotographerProfile`.
export async function seedProfessionalJobOffer(
  prisma: ReturnType<typeof createPrismaClient>,
): Promise<void> {
  const passwordHash = await hash(getSeedUserPassword());
  const user = await seedUser(prisma, SEED_PROFESSIONAL_EMAIL, ['professional']);
  await seedCredentialAccount(prisma, user.id, passwordHash);

  const existingProfile = await prisma.professionalProfile.findUnique({
    where: { userId: user.id },
  });
  if (existingProfile) {
    return;
  }

  const storage = seedStorageFromEnv();
  const logoObjectKey = 'seed/professional/logo/original.jpg';
  const logoVariants = placeholderVariants('seed/professional/logo');
  const logoUpload = await prisma.upload.upsert({
    where: { objectKey: logoObjectKey },
    create: {
      ownerId: user.id,
      purpose: 'logo',
      status: 'processed',
      mimeType: 'image/jpeg',
      declaredSizeBytes: 2048,
      actualSizeBytes: 2048,
      width: 512,
      height: 512,
      objectKey: logoObjectKey,
      variants: logoVariants,
      virusScanStatus: 'clean',
    },
    update: {},
  });
  await uploadPlaceholderVariants(storage, logoVariants);

  await prisma.professionalProfile.create({
    data: {
      userId: user.id,
      companyName: SEED_PROFESSIONAL_COMPANY_NAME,
      website: 'https://example.com',
      vatNumber: 'LU12345678',
      logoUploadId: logoUpload.id,
      verified: true,
    },
  });

  const jobOffer = await prisma.jobOffer.create({
    data: {
      professionalId: (
        await prisma.professionalProfile.findUniqueOrThrow({ where: { userId: user.id } })
      ).id,
      slug: SEED_JOB_OFFER_SLUG,
      title: SEED_JOB_OFFER_TITLE,
      description:
        'Looking for an experienced event photographer to cover a corporate gala evening in Luxembourg City, including candid shots and formal group photos.',
      category: 'event',
      city: 'Luxembourg City',
      countryCode: 'LU',
      remote: false,
      compensation: {
        min: { amountCents: 60000, currency: 'EUR' },
        max: { amountCents: 90000, currency: 'EUR' },
      },
      status: 'draft',
    },
  });

  await prisma.$executeRaw`
    UPDATE "JobOffer"
    SET location = ST_SetSRID(ST_MakePoint(${SEED_JOB_OFFER_LOCATION.lng}, ${SEED_JOB_OFFER_LOCATION.lat}), 4326)::geography
    WHERE id = ${jobOffer.id}
  `;

  const publishedAt = new Date();
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 60);

  const listing = await prisma.listing.create({
    data: {
      ownerId: jobOffer.id,
      kind: 'job_offer',
      plan: 'free',
      priceCents: 0,
      currency: 'EUR',
      paidAt: publishedAt,
      expiresAt,
    },
  });

  await prisma.jobOffer.update({
    where: { id: jobOffer.id },
    data: {
      status: 'published',
      publishedAt,
      expiresAt,
      listingId: listing.id,
    },
  });
}

export async function seedDatabase(prisma: ReturnType<typeof createPrismaClient>): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db seed: refusing to run with NODE_ENV=production');
  }
  await seedCountry(prisma);
  await seedUsers(prisma);
  await seedAdminPermissions(prisma);
  await seedPhotographerProfiles(prisma);
  await seedPlatformSetting(prisma, 'feePercent', 5);
  await seedPlatformSetting(prisma, 'autoReleaseDays', 7);
  await seedRequestAndQuote(prisma);
  await seedQuoteConversation(prisma);
  await seedVerificationCase(prisma);
  await seedPaidBooking(prisma);
  await seedProfessionalJobOffer(prisma);
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
