import type { Processor } from 'bullmq';
import type { Logger } from 'nestjs-pino';
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

export interface QuoteExpiryTransactionClient {
  quote: UpdateManyRepository<QuoteExpiryWhere, QuoteExpiryData>;
  request: UpdateManyRepository<RequestExpiryWhere, RequestExpiryData>;
  auditLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
}

export interface QuoteExpiryDeps {
  prisma: {
    client: { $transaction<T>(fn: (tx: QuoteExpiryTransactionClient) => Promise<T>): Promise<T> };
  };
  logger: Logger;
}

export function createQuoteExpiryProcessor(deps: QuoteExpiryDeps): Processor {
  return async () => {
    const now = new Date();

    const { expiredQuotes, closedRequests } = await deps.prisma.client.$transaction(async (tx) => {
      const closedRequests = await tx.request.updateMany({
        where: { status: { in: ['open', 'quoted'] }, expiresAt: { lt: now }, deletedAt: null },
        data: { status: 'closed' },
      });

      const expiredQuotes = await tx.quote.updateMany({
        where: {
          status: 'sent',
          OR: [
            { validUntil: { lt: now } },
            { request: { status: { in: ['closed', 'cancelled'] } } },
          ],
        },
        data: { status: 'expired' },
      });

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

      return { expiredQuotes, closedRequests };
    });

    deps.logger.log(
      { expiredQuotes: expiredQuotes.count, closedRequests: closedRequests.count },
      'quote-expiry: swept expired quotes and requests',
    );
  };
}
