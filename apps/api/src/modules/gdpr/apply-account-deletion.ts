import { HttpException } from '@nestjs/common';
import type { AuditActorType, DataRequest, DataRequestChannel, Prisma } from '@photoo/db';

const CANCELLABLE_QUOTE_STATUSES = ['draft', 'sent'] as const;

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

export interface AccountDeletionAuditEntry {
  actorType: AuditActorType;
  actorId: string;
  action: string;
  extraAfter?: Record<string, unknown>;
  ip?: string | null;
}

export interface ApplyAccountDeletionParams {
  userId: string;
  receivedAt: Date;
  requestedAt?: Date;
  channel: DataRequestChannel;
  audit: AccountDeletionAuditEntry;
}

// Shared by self-service deletion (`data-requests.service.ts`) and the admin
// "log an offline deletion request" path (docs/steps/378-offline-data-requests.md
// "API -> Delete"): both must apply the exact same immediate effects, since the
// worker's anonymisation sweep treats every `pending` delete row the same way
// regardless of who created it.
export async function applyAccountDeletion(
  tx: Prisma.TransactionClient,
  { userId, receivedAt, requestedAt, channel, audit }: ApplyAccountDeletionParams,
): Promise<DataRequest> {
  const profile = await tx.photographerProfile.findUnique({
    where: { userId },
    select: { id: true, isPublished: true },
  });
  const professional = await tx.professionalProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  const guarded = await tx.user.updateMany({
    where: { id: userId, status: 'active' },
    data: { status: 'deleted', deletedAt: new Date() },
  });
  if (guarded.count === 0) {
    throw conflict('Account is already deleted');
  }

  await tx.session.deleteMany({ where: { userId } });
  await tx.device.deleteMany({ where: { userId } });

  if (profile?.isPublished) {
    await tx.photographerProfile.update({
      where: { id: profile.id },
      data: { isPublished: false },
    });
  }

  const cancelledRequestIds = await cancelOwnRequests(tx, userId);
  const declinedQuoteIds = await cancelOwnQuotesAsClient(tx, userId);
  const withdrawnQuoteIds = await cancelOwnQuotesAsPhotographer(tx, profile?.id);
  const closedJobOfferIds = await closeOwnJobOffers(tx, professional?.id);
  const withdrawnJobApplicationIds = await withdrawOwnJobApplications(tx, profile?.id);

  const row = await tx.dataRequest.create({
    data: {
      userId,
      type: 'delete',
      status: 'pending',
      channel,
      receivedAt,
      ...(requestedAt ? { requestedAt } : {}),
    },
  });

  await tx.auditLog.create({
    data: {
      actorType: audit.actorType,
      actorId: audit.actorId,
      action: audit.action,
      targetType: 'DataRequest',
      targetId: row.id,
      before: { userStatus: 'active', profileIsPublished: profile?.isPublished ?? null },
      after: {
        userStatus: 'deleted',
        cancelledRequestIds,
        declinedQuoteIds,
        withdrawnQuoteIds,
        closedJobOfferIds,
        withdrawnJobApplicationIds,
        ...audit.extraAfter,
      },
      ip: audit.ip ?? null,
    },
  });

  return row;
}

// Mirrors requests.service.ts's own `cancel`: cancelling the request also
// declines its still-`sent` quotes, so the same cascading effect applies
// when the request's owner is the one being deleted.
async function cancelOwnRequests(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const openRequests = await tx.request.findMany({
    where: { clientId: userId, status: { in: ['open', 'quoted'] } },
    select: { id: true },
  });
  const ids = openRequests.map((request) => request.id);
  if (ids.length === 0) {
    return [];
  }
  await tx.request.updateMany({ where: { id: { in: ids } }, data: { status: 'cancelled' } });
  await tx.quote.updateMany({
    where: { requestId: { in: ids }, status: 'sent' },
    data: { status: 'declined' },
  });
  return ids;
}

async function cancelOwnQuotesAsClient(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string[]> {
  const rows = await tx.quote.findMany({
    where: { clientId: userId, status: { in: [...CANCELLABLE_QUOTE_STATUSES] } },
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await tx.quote.updateMany({ where: { id: { in: ids } }, data: { status: 'declined' } });
  }
  return ids;
}

async function cancelOwnQuotesAsPhotographer(
  tx: Prisma.TransactionClient,
  profileId: string | undefined,
): Promise<string[]> {
  if (!profileId) {
    return [];
  }
  const rows = await tx.quote.findMany({
    where: { photographerId: profileId, status: { in: [...CANCELLABLE_QUOTE_STATUSES] } },
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await tx.quote.updateMany({ where: { id: { in: ids } }, data: { status: 'withdrawn' } });
  }
  return ids;
}

// Mirrors `cancelOwnQuotesAsPhotographer`: nothing stays reachable on the
// public job board during the grace period, the same way the
// photographer profile is unpublished above.
async function closeOwnJobOffers(
  tx: Prisma.TransactionClient,
  professionalId: string | undefined,
): Promise<string[]> {
  if (!professionalId) {
    return [];
  }
  const rows = await tx.jobOffer.findMany({
    where: { professionalId, status: 'published' },
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await tx.jobOffer.updateMany({ where: { id: { in: ids } }, data: { status: 'closed' } });
  }
  return ids;
}

async function withdrawOwnJobApplications(
  tx: Prisma.TransactionClient,
  photographerProfileId: string | undefined,
): Promise<string[]> {
  if (!photographerProfileId) {
    return [];
  }
  const rows = await tx.jobApplication.findMany({
    where: { photographerId: photographerProfileId, status: 'submitted' },
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await tx.jobApplication.updateMany({
      where: { id: { in: ids } },
      data: { status: 'withdrawn' },
    });
  }
  return ids;
}
