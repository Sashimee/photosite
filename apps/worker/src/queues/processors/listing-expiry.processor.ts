import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';

export interface ExpiredJobOfferRow {
  id: string;
  professionalId: string;
  title: string;
}

export interface JobOfferExpiryWhere {
  status: 'published';
  expiresAt: { lte: Date };
}

export interface JobOfferExpiryData {
  status: 'expired';
}

export interface ListingExpiryTransactionClient {
  jobOffer: {
    updateManyAndReturn(args: {
      where: JobOfferExpiryWhere;
      data: JobOfferExpiryData;
    }): Promise<ExpiredJobOfferRow[]>;
  };
  auditLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export interface ListingExpiryDeps {
  prisma: {
    client: {
      $transaction<T>(fn: (tx: ListingExpiryTransactionClient) => Promise<T>): Promise<T>;
    };
  };
  logger: Logger;
}

// `JobOffer.expiresAt` mirrors its current `Listing.expiresAt`
// (docs/steps/1A.13-professionals.md), so the sweep reads it directly
// rather than joining `Listing`. The `status: 'published'` guard in the
// same atomic `updateManyAndReturn` makes a second run of this job a no-op
// for rows it already flipped, and closes off a concurrent `close()`.
// TODO(api-developer): notify the professional once NOTIFICATION_TYPES has
// a type for this (issue #264) - every existing type/template is either the
// wrong audience or the wrong copy for "your listing expired".
export function createListingExpiryProcessor(deps: ListingExpiryDeps): Processor {
  return async () => {
    const now = new Date();

    const expiredOffers = await deps.prisma.client.$transaction(async (tx) => {
      const expired = await tx.jobOffer.updateManyAndReturn({
        where: { status: 'published', expiresAt: { lte: now } },
        data: { status: 'expired' },
      });

      if (expired.length > 0) {
        await tx.auditLog.create({
          data: {
            actorType: 'system',
            actorId: null,
            action: 'listing_expiry.swept',
            targetType: 'System',
            targetId: null,
            after: { expiredJobOffers: expired.length },
          },
        });
      }

      return expired;
    });

    deps.logger.log(
      { expiredJobOffers: expiredOffers.length },
      'listing-expiry: swept expired listings',
    );
  };
}
