import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
import {
  createNotification,
  type CreateNotificationDeps,
} from '../../notifications/create-notification.js';
import type { UpdateManyRepository } from './types.js';

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

export interface QuoteExpiryTransactionClient {
  quote: {
    findMany(args: { where: QuoteExpiryWhere }): Promise<ExpiredQuoteRow[]>;
    updateMany(args: {
      where: { id: { in: string[] } };
      data: QuoteExpiryData;
    }): Promise<{ count: number }>;
  };
  request: UpdateManyRepository<RequestExpiryWhere, RequestExpiryData>;
  auditLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export interface PhotographerProfileRow {
  userId: string;
  displayName: string;
}

export interface UserNameRow {
  name: string | null;
}

export interface RequestTitleRow {
  title: string;
}

export interface QuoteExpiryDeps {
  prisma: {
    client: {
      $transaction<T>(fn: (tx: QuoteExpiryTransactionClient) => Promise<T>): Promise<T>;
      photographerProfile: {
        findUnique(args: { where: { id: string } }): Promise<PhotographerProfileRow | null>;
      };
      user: { findUnique(args: { where: { id: string } }): Promise<UserNameRow | null> };
      request: { findUnique(args: { where: { id: string } }): Promise<RequestTitleRow | null> };
    };
  };
  notify: CreateNotificationDeps;
  logger: Logger;
}

function quoteExpiryWhere(now: Date): QuoteExpiryWhere {
  return {
    status: 'sent',
    OR: [{ validUntil: { lt: now } }, { request: { status: { in: ['closed', 'cancelled'] } } }],
  };
}

async function notifyExpiredQuote(deps: QuoteExpiryDeps, quote: ExpiredQuoteRow): Promise<void> {
  const [profile, client, request] = await Promise.all([
    deps.prisma.client.photographerProfile.findUnique({ where: { id: quote.photographerId } }),
    deps.prisma.client.user.findUnique({ where: { id: quote.clientId } }),
    quote.requestId
      ? deps.prisma.client.request.findUnique({ where: { id: quote.requestId } })
      : Promise.resolve(null),
  ]);

  const total = { amountCents: quote.totalCents, currency: quote.currency };
  const requestTitle = request?.title;

  await createNotification(deps.notify, quote.clientId, 'quote_expired', {
    quoteId: quote.id,
    requestId: quote.requestId ?? undefined,
    requestTitle,
    total,
    counterpartName: profile?.displayName,
  });

  if (profile) {
    await createNotification(deps.notify, profile.userId, 'quote_expired', {
      quoteId: quote.id,
      requestId: quote.requestId ?? undefined,
      requestTitle,
      total,
      counterpartName: client?.name ?? undefined,
    });
  }
}

export function createQuoteExpiryProcessor(deps: QuoteExpiryDeps): Processor {
  return async () => {
    const now = new Date();

    const { expiredQuotes, closedRequests, expiring } = await deps.prisma.client.$transaction(
      async (tx) => {
        const closedRequests = await tx.request.updateMany({
          where: { status: { in: ['open', 'quoted'] }, expiresAt: { lt: now }, deletedAt: null },
          data: { status: 'closed' },
        });

        const expiring = await tx.quote.findMany({ where: quoteExpiryWhere(now) });

        let expiredQuotes = { count: 0 };
        if (expiring.length > 0) {
          expiredQuotes = await tx.quote.updateMany({
            where: { id: { in: expiring.map((quote) => quote.id) } },
            data: { status: 'expired' },
          });
        }

        if (expiredQuotes.count > 0 || closedRequests.count > 0) {
          await tx.auditLog.create({
            data: {
              actorType: 'system',
              actorId: null,
              action: 'quote_expiry.swept',
              targetType: 'System',
              targetId: null,
              after: { expiredQuotes: expiredQuotes.count, closedRequests: closedRequests.count },
            },
          });
        }

        return { expiredQuotes, closedRequests, expiring };
      },
    );

    for (const quote of expiring) {
      try {
        await notifyExpiredQuote(deps, quote);
      } catch (error) {
        deps.logger.error(
          { err: error, quoteId: quote.id },
          'quote-expiry: failed to create quote_expired notifications',
        );
      }
    }

    deps.logger.log(
      { expiredQuotes: expiredQuotes.count, closedRequests: closedRequests.count },
      'quote-expiry: swept expired quotes and requests',
    );
  };
}
