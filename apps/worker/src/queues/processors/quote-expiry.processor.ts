import { notifyJobOptions, truncateNotificationText } from '@photoo/shared';
import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import {
  insertNotification,
  type NotifyInsertClient,
} from '../../notifications/create-notification.js';
import type { JobQueueLike, UpdateManyRepository } from './types.js';

type RequestLifecycleStatus = 'open' | 'quoted' | 'closed' | 'cancelled';

interface QuoteExpiryWhere {
  status: 'sent';
  OR: [{ validUntil: { lt: Date } }, { request: { status: { in: RequestLifecycleStatus[] } } }];
}

interface QuoteExpiryData {
  status: 'expired';
}

interface RequestExpiryWhere {
  status: { in: RequestLifecycleStatus[] };
  expiresAt: { lt: Date };
  deletedAt: null;
}

interface RequestExpiryData {
  status: 'closed';
}

export interface ExpiredQuoteRow {
  id: string;
  requestId: string | null;
  photographerId: string;
  clientId: string;
  totalCents: number;
  currency: string;
}

export interface PhotographerProfileRow {
  userId: string;
  displayName: string;
}

export interface RequestTitleRow {
  title: string;
}

// Everything the transaction needs, including notification inserts: a
// concurrent accept() is closed off by the `status: 'sent'` guard staying
// in the same atomic `updateManyAndReturn`, and inserting the Notification
// rows here means they only exist if the expiry itself committed.
export interface QuoteExpiryTransactionClient extends NotifyInsertClient {
  quote: {
    updateManyAndReturn(args: {
      where: QuoteExpiryWhere;
      data: QuoteExpiryData;
    }): Promise<ExpiredQuoteRow[]>;
  };
  request: UpdateManyRepository<RequestExpiryWhere, RequestExpiryData> & {
    findUnique(args: { where: { id: string } }): Promise<RequestTitleRow | null>;
  };
  photographerProfile: {
    findUnique(args: { where: { id: string } }): Promise<PhotographerProfileRow | null>;
  };
  auditLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export interface QuoteExpiryDeps {
  prisma: {
    client: {
      $transaction<T>(fn: (tx: QuoteExpiryTransactionClient) => Promise<T>): Promise<T>;
    };
  };
  notifyQueue: JobQueueLike;
  logger: Logger;
}

function quoteExpiryWhere(now: Date): QuoteExpiryWhere {
  return {
    status: 'sent',
    OR: [{ validUntil: { lt: now } }, { request: { status: { in: ['closed', 'cancelled'] } } }],
  };
}

// Inserts the quote_expired row(s) for one expired quote inside the caller's
// transaction; returns the ids to enqueue once that transaction commits.
async function insertExpiredQuoteNotifications(
  tx: QuoteExpiryTransactionClient,
  quote: ExpiredQuoteRow,
): Promise<string[]> {
  const [profile, request] = await Promise.all([
    tx.photographerProfile.findUnique({ where: { id: quote.photographerId } }),
    quote.requestId
      ? tx.request.findUnique({ where: { id: quote.requestId } })
      : Promise.resolve(null),
  ]);

  const total = { amountCents: quote.totalCents, currency: quote.currency };
  const requestTitle = request?.title ? truncateNotificationText(request.title) : undefined;
  const ids: string[] = [];

  ids.push(
    await insertNotification(tx, quote.clientId, 'quote_expired', {
      quoteId: quote.id,
      requestId: quote.requestId ?? undefined,
      requestTitle,
      total,
      counterpartName: profile ? truncateNotificationText(profile.displayName) : undefined,
    }),
  );

  // counterpartName is omitted for the photographer's copy rather than set
  // from the client's User.name (S6/compliance): that field defaults to the
  // client's email local part and is never shown to another party.
  if (profile) {
    ids.push(
      await insertNotification(tx, profile.userId, 'quote_expired', {
        quoteId: quote.id,
        requestId: quote.requestId ?? undefined,
        requestTitle,
        total,
      }),
    );
  }

  return ids;
}

export function createQuoteExpiryProcessor(deps: QuoteExpiryDeps): Processor {
  return async () => {
    const now = new Date();

    const { expiredQuotes, closedRequests, notificationIds } =
      await deps.prisma.client.$transaction(async (tx) => {
        const closedRequests = await tx.request.updateMany({
          where: { status: { in: ['open', 'quoted'] }, expiresAt: { lt: now }, deletedAt: null },
          data: { status: 'closed' },
        });

        const expiredQuotes = await tx.quote.updateManyAndReturn({
          where: quoteExpiryWhere(now),
          data: { status: 'expired' },
        });

        const notificationIds: string[] = [];
        for (const quote of expiredQuotes) {
          notificationIds.push(...(await insertExpiredQuoteNotifications(tx, quote)));
        }

        if (expiredQuotes.length > 0 || closedRequests.count > 0) {
          await tx.auditLog.create({
            data: {
              actorType: 'system',
              actorId: null,
              action: 'quote_expiry.swept',
              targetType: 'System',
              targetId: null,
              after: { expiredQuotes: expiredQuotes.length, closedRequests: closedRequests.count },
            },
          });
        }

        return { expiredQuotes, closedRequests, notificationIds };
      });

    for (const notificationId of notificationIds) {
      try {
        await deps.notifyQueue.add('notify', { notificationId }, notifyJobOptions(notificationId));
      } catch (error) {
        deps.logger.error(
          { err: error, notificationId },
          'quote-expiry: failed to enqueue a quote_expired notification',
        );
      }
    }

    deps.logger.log(
      { expiredQuotes: expiredQuotes.length, closedRequests: closedRequests.count },
      'quote-expiry: swept expired quotes and requests',
    );
  };
}
