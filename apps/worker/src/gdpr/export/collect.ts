import type { PrismaClient } from '@photoo/db';

export interface UserExportRow {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  name: string | null;
  locale: string;
  countryCode: string;
  roles: string[];
  status: string;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AccountExportRow {
  id: string;
  providerId: string;
  createdAt: string;
}

export interface SessionExportRow {
  id: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: string;
  twoFactorVerifiedAt: string | null;
  createdAt: string;
}

export interface DeviceExportRow {
  id: string;
  platform: string;
  lastSeenAt: string;
  createdAt: string;
}

export interface ConsentExportRow {
  id: string;
  purpose: string;
  granted: boolean;
  policyVersion: string;
  recordedAt: string;
}

export interface NotificationExportRow {
  id: string;
  type: string;
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

export interface RequestExportRow {
  id: string;
  title: string;
  category: string;
  description: string;
  eventDate: string;
  dateFlexible: boolean;
  address: unknown;
  city: string;
  countryCode: string;
  budgetMinCents: number;
  budgetMaxCents: number;
  currency: string;
  usage: string;
  status: string;
  expiresAt: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteExportRow {
  id: string;
  role: 'client' | 'photographer';
  requestId: string | null;
  photographerId: string;
  clientId: string;
  productId: string | null;
  productTierId: string | null;
  lineItems: unknown;
  subtotalCents: number;
  platformFeeCents: number;
  totalCents: number;
  feePercent: string;
  licenceUsage: string;
  licenceTextVersion: string | null;
  currency: string;
  validUntil: string;
  message: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhotographerProfileExportRow {
  id: string;
  slug: string;
  displayName: string;
  headline: string | null;
  bio: unknown;
  links: unknown;
  categories: string[];
  languages: string[];
  city: string;
  countryCode: string;
  verificationStatus: string;
  ratingAvg: string;
  ratingCount: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductTierExportRow {
  id: string;
  usage: string;
  priceCents: number;
  currency: string;
  description: string | null;
  licenceTextVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductExportRow {
  id: string;
  title: unknown;
  description: unknown;
  category: string;
  durationMinutes: number;
  deliverables: unknown;
  basePriceCents: number;
  currency: string;
  isActive: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
  tiers: ProductTierExportRow[];
}

export interface PortfolioImageExportRow {
  id: string;
  uploadId: string;
  order: number;
  status: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface UploadExportRow {
  id: string;
  purpose: string;
  status: string;
  mimeType: string;
  declaredSizeBytes: number;
  actualSizeBytes: number | null;
  width: number | null;
  height: number | null;
  virusScanStatus: string;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationDocumentExportRow {
  id: string;
  documentKey: string;
  mimeType: string;
  actualSizeBytes: number | null;
  virusScanStatus: string;
  createdAt: string;
}

export interface VerificationCaseExportRow {
  id: string;
  countryCode: string;
  status: string;
  submittedAt: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  documents: VerificationDocumentExportRow[];
}

export interface MessageCounterpart {
  name: string;
  profileSlug: string | null;
}

export interface MessageAttachmentExportRow {
  id: string;
  mimeType: string;
  actualSizeBytes: number | null;
}

export interface MessageExportRow {
  id: string;
  conversationId: string;
  isSelf: boolean;
  counterpart: MessageCounterpart | null;
  body: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  attachments: MessageAttachmentExportRow[];
}

export interface ExportBinaryFile {
  arcPath: string;
  bucket: 'private';
  objectKey: string;
}

export interface CollectedExport {
  user: UserExportRow;
  accounts: AccountExportRow[];
  sessions: SessionExportRow[];
  devices: DeviceExportRow[];
  consents: ConsentExportRow[];
  notifications: NotificationExportRow[];
  requests: RequestExportRow[];
  quotes: QuoteExportRow[];
  photographerProfile: PhotographerProfileExportRow | null;
  products: ProductExportRow[];
  portfolioImages: PortfolioImageExportRow[];
  uploads: UploadExportRow[];
  verificationCases: VerificationCaseExportRow[];
  messages: MessageExportRow[];
  files: ExportBinaryFile[];
}

function extensionForMimeType(mimeType: string): string {
  const subtype = mimeType.split('/')[1] ?? 'bin';
  if (subtype === 'jpeg') {
    return 'jpg';
  }
  return subtype.split('+')[0] ?? 'bin';
}

function resolveCounterpartName(
  user: { name: string | null },
  profile: { displayName: string; slug: string } | null,
): MessageCounterpart {
  return {
    name: profile?.displayName ?? user.name ?? 'Photoo user',
    profileSlug: profile?.slug ?? null,
  };
}

// One collector for the whole export rather than one file per entity
// (docs/steps/1A.12-gdpr.md "the streaming export builder with one
// collector per entity"): every section here reads at most one entity type
// and returns plain, already-sanitised rows, so the per-entity boundary
// lives in the return shape and in `archive.ts`'s per-file write, not in a
// dozen near-identical one-query modules. Every field list below is
// deliberate: never the counterpart's email/phone/address in `messages`,
// never `AuditLog`, admin notes, provenance scores/vendors, password
// hashes, 2FA secrets or backup codes, and verification document bytes are
// listed in `files` for portfolio/avatar/cover only, never for a
// `VerificationDocument`'s upload.
export async function collectExportData(
  prisma: PrismaClient,
  userId: string,
): Promise<CollectedExport> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      name: true,
      locale: true,
      countryCode: true,
      roles: true,
      status: true,
      twoFactorEnabled: true,
      lastLoginAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const accounts = await prisma.account.findMany({
    where: { userId },
    select: { id: true, providerId: true, createdAt: true },
  });

  const sessions = await prisma.session.findMany({
    where: { userId },
    select: {
      id: true,
      userAgent: true,
      ip: true,
      expiresAt: true,
      twoFactorVerifiedAt: true,
      createdAt: true,
    },
  });

  const devices = await prisma.device.findMany({
    where: { userId },
    select: { id: true, platform: true, lastSeenAt: true, createdAt: true },
  });

  const consents = await prisma.consentRecord.findMany({
    where: { userId },
    select: { id: true, purpose: true, granted: true, policyVersion: true, recordedAt: true },
    orderBy: { recordedAt: 'asc' },
  });

  const notifications = await prisma.notification.findMany({
    where: { userId },
    select: { id: true, type: true, payload: true, readAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const requests = await prisma.request.findMany({
    where: { clientId: userId },
    select: {
      id: true,
      title: true,
      category: true,
      description: true,
      eventDate: true,
      dateFlexible: true,
      address: true,
      city: true,
      countryCode: true,
      budgetMinCents: true,
      budgetMaxCents: true,
      currency: true,
      usage: true,
      status: true,
      expiresAt: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const profile = await prisma.photographerProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      slug: true,
      displayName: true,
      headline: true,
      bio: true,
      links: true,
      categories: true,
      languages: true,
      city: true,
      countryCode: true,
      verificationStatus: true,
      ratingAvg: true,
      ratingCount: true,
      isPublished: true,
      avatarUploadId: true,
      coverUploadId: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const quoteRows = await prisma.quote.findMany({
    where: profile
      ? { OR: [{ clientId: userId }, { photographerId: profile.id }] }
      : { clientId: userId },
    select: {
      id: true,
      requestId: true,
      photographerId: true,
      clientId: true,
      productId: true,
      productTierId: true,
      lineItems: true,
      subtotalCents: true,
      platformFeeCents: true,
      totalCents: true,
      feePercent: true,
      licenceUsage: true,
      licenceTextVersion: true,
      currency: true,
      validUntil: true,
      message: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const quotes: QuoteExportRow[] = quoteRows.map((quote) => ({
    ...quote,
    feePercent: quote.feePercent.toString(),
    validUntil: quote.validUntil.toISOString(),
    createdAt: quote.createdAt.toISOString(),
    updatedAt: quote.updatedAt.toISOString(),
    role: quote.clientId === userId ? 'client' : 'photographer',
  }));

  const products: ProductExportRow[] = profile
    ? (
        await prisma.product.findMany({
          where: { profileId: profile.id },
          select: {
            id: true,
            title: true,
            description: true,
            category: true,
            durationMinutes: true,
            deliverables: true,
            basePriceCents: true,
            currency: true,
            isActive: true,
            order: true,
            createdAt: true,
            updatedAt: true,
            tiers: {
              select: {
                id: true,
                usage: true,
                priceCents: true,
                currency: true,
                description: true,
                licenceTextVersion: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
          orderBy: { order: 'asc' },
        })
      ).map((product) => ({
        ...product,
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
        tiers: product.tiers.map((tier) => ({
          ...tier,
          createdAt: tier.createdAt.toISOString(),
          updatedAt: tier.updatedAt.toISOString(),
        })),
      }))
    : [];

  const portfolioImageRows = profile
    ? await prisma.portfolioImage.findMany({
        where: { profileId: profile.id, deletedAt: null },
        select: {
          id: true,
          uploadId: true,
          order: true,
          status: true,
          width: true,
          height: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { order: 'asc' },
      })
    : [];
  const portfolioImages: PortfolioImageExportRow[] = portfolioImageRows.map((image) => ({
    ...image,
    createdAt: image.createdAt.toISOString(),
    updatedAt: image.updatedAt.toISOString(),
  }));

  const uploadRows = await prisma.upload.findMany({
    where: { ownerId: userId },
    select: {
      id: true,
      purpose: true,
      status: true,
      mimeType: true,
      declaredSizeBytes: true,
      actualSizeBytes: true,
      width: true,
      height: true,
      virusScanStatus: true,
      objectKey: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const uploads: UploadExportRow[] = uploadRows.map((upload) => ({
    id: upload.id,
    purpose: upload.purpose,
    status: upload.status,
    mimeType: upload.mimeType,
    declaredSizeBytes: upload.declaredSizeBytes,
    actualSizeBytes: upload.actualSizeBytes,
    width: upload.width,
    height: upload.height,
    virusScanStatus: upload.virusScanStatus,
    createdAt: upload.createdAt.toISOString(),
    updatedAt: upload.updatedAt.toISOString(),
  }));

  const files: ExportBinaryFile[] = [];
  const uploadById = new Map(uploadRows.map((upload) => [upload.id, upload]));
  for (const image of portfolioImageRows) {
    const upload = uploadById.get(image.uploadId);
    if (upload) {
      files.push({
        arcPath: `files/portfolio/${image.id}.${extensionForMimeType(upload.mimeType)}`,
        bucket: 'private',
        objectKey: upload.objectKey,
      });
    }
  }
  if (profile?.avatarUploadId) {
    const upload = uploadById.get(profile.avatarUploadId);
    if (upload) {
      files.push({
        arcPath: `files/avatar.${extensionForMimeType(upload.mimeType)}`,
        bucket: 'private',
        objectKey: upload.objectKey,
      });
    }
  }
  if (profile?.coverUploadId) {
    const upload = uploadById.get(profile.coverUploadId);
    if (upload) {
      files.push({
        arcPath: `files/cover.${extensionForMimeType(upload.mimeType)}`,
        bucket: 'private',
        objectKey: upload.objectKey,
      });
    }
  }

  const verificationCaseRows = await prisma.verificationCase.findMany({
    where: { userId },
    select: {
      id: true,
      countryCode: true,
      status: true,
      submittedAt: true,
      decidedAt: true,
      rejectionReason: true,
      createdAt: true,
      updatedAt: true,
      documents: {
        select: {
          id: true,
          documentKey: true,
          createdAt: true,
          upload: { select: { mimeType: true, actualSizeBytes: true, virusScanStatus: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
  const verificationCases: VerificationCaseExportRow[] = verificationCaseRows.map((row) => ({
    id: row.id,
    countryCode: row.countryCode,
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    rejectionReason: row.rejectionReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    documents: row.documents.map((document) => ({
      id: document.id,
      documentKey: document.documentKey,
      mimeType: document.upload.mimeType,
      actualSizeBytes: document.upload.actualSizeBytes,
      virusScanStatus: document.upload.virusScanStatus,
      createdAt: document.createdAt.toISOString(),
    })),
  }));

  const participantRows = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: { conversationId: true },
  });
  const conversationIds = participantRows.map((row) => row.conversationId);

  const otherParticipants = conversationIds.length
    ? await prisma.conversationParticipant.findMany({
        where: { conversationId: { in: conversationIds }, userId: { not: userId } },
        select: {
          conversationId: true,
          user: {
            select: {
              id: true,
              name: true,
              photographerProfile: { select: { displayName: true, slug: true } },
            },
          },
        },
      })
    : [];
  const counterpartByConversation = new Map<string, MessageCounterpart>();
  for (const participant of otherParticipants) {
    counterpartByConversation.set(
      participant.conversationId,
      resolveCounterpartName(participant.user, participant.user.photographerProfile),
    );
  }

  const messageRows = conversationIds.length
    ? await prisma.message.findMany({
        where: { conversationId: { in: conversationIds } },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          body: true,
          editedAt: true,
          deletedAt: true,
          createdAt: true,
          attachments: {
            select: {
              id: true,
              upload: { select: { mimeType: true, actualSizeBytes: true } },
            },
          },
        },
        orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
      })
    : [];
  const messages: MessageExportRow[] = messageRows.map((message) => {
    const isSelf = message.senderId === userId;
    return {
      id: message.id,
      conversationId: message.conversationId,
      isSelf,
      counterpart: isSelf ? null : (counterpartByConversation.get(message.conversationId) ?? null),
      body: message.body,
      editedAt: message.editedAt?.toISOString() ?? null,
      deletedAt: message.deletedAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        mimeType: attachment.upload.mimeType,
        actualSizeBytes: attachment.upload.actualSizeBytes,
      })),
    };
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      name: user.name,
      locale: user.locale,
      countryCode: user.countryCode,
      roles: user.roles,
      status: user.status,
      twoFactorEnabled: user.twoFactorEnabled,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
    accounts: accounts.map((account) => ({
      id: account.id,
      providerId: account.providerId,
      createdAt: account.createdAt.toISOString(),
    })),
    sessions: sessions.map((session) => ({
      id: session.id,
      userAgent: session.userAgent,
      ip: session.ip,
      expiresAt: session.expiresAt.toISOString(),
      twoFactorVerifiedAt: session.twoFactorVerifiedAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
    })),
    devices: devices.map((device) => ({
      id: device.id,
      platform: device.platform,
      lastSeenAt: device.lastSeenAt.toISOString(),
      createdAt: device.createdAt.toISOString(),
    })),
    consents: consents.map((consent) => ({
      id: consent.id,
      purpose: consent.purpose,
      granted: consent.granted,
      policyVersion: consent.policyVersion,
      recordedAt: consent.recordedAt.toISOString(),
    })),
    notifications: notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      payload: notification.payload,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    })),
    requests: requests.map((request) => ({
      ...request,
      eventDate: request.eventDate.toISOString(),
      expiresAt: request.expiresAt.toISOString(),
      deletedAt: request.deletedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    })),
    quotes,
    photographerProfile: profile
      ? {
          id: profile.id,
          slug: profile.slug,
          displayName: profile.displayName,
          headline: profile.headline,
          bio: profile.bio,
          links: profile.links,
          categories: profile.categories,
          languages: profile.languages,
          city: profile.city,
          countryCode: profile.countryCode,
          verificationStatus: profile.verificationStatus,
          ratingAvg: profile.ratingAvg.toString(),
          ratingCount: profile.ratingCount,
          isPublished: profile.isPublished,
          createdAt: profile.createdAt.toISOString(),
          updatedAt: profile.updatedAt.toISOString(),
        }
      : null,
    products,
    portfolioImages,
    uploads,
    verificationCases,
    messages,
    files,
  };
}
