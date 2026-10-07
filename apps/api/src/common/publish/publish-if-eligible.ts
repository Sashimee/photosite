import type { Prisma } from '@photoo/db';
import { PublishPolicy } from './publish-policy.js';

export async function publishIfEligible(
  tx: Prisma.TransactionClient,
  profileId: string,
): Promise<boolean> {
  const profile = await tx.photographerProfile.findUnique({
    where: { id: profileId },
    select: {
      verificationStatus: true,
      stripePayoutsEnabled: true,
      isPublished: true,
      deletedAt: true,
      user: {
        select: {
          status: true,
          roles: true,
          dataRequests: {
            where: { type: 'delete', status: 'pending' },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  if (
    !profile ||
    profile.isPublished ||
    profile.deletedAt !== null ||
    !PublishPolicy.canPublish(profile) ||
    profile.user.status !== 'active' ||
    !profile.user.roles.includes('photographer') ||
    profile.user.dataRequests.length > 0
  ) {
    return false;
  }

  const result = await tx.photographerProfile.updateMany({
    where: {
      id: profileId,
      isPublished: false,
      deletedAt: null,
      verificationStatus: 'verified',
      stripePayoutsEnabled: true,
      user: { status: 'active', roles: { has: 'photographer' } },
    },
    data: { isPublished: true },
  });
  return result.count === 1;
}
