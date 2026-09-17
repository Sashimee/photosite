import { HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type Quote } from '@photoo/db';
import {
  quoteTotals,
  type CreateQuoteRequestSchema,
  type CursorPaginationQuerySchema,
  type DirectQuoteRequestSchema,
  type LineItem,
  type QuotesMineQuerySchema,
  type QuoteSchema,
} from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import type { z } from 'zod';
import { requireRole } from '../../common/auth/require-role.js';
import {
  decodeCreatedAtCursor,
  encodeCreatedAtCursor,
} from '../../common/pagination/created-at-cursor.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { mapQuote } from './quote-mapper.js';
import { QUOTE_EVENTS, type QuoteEvents } from './quote-events.js';
import { QuotesRateLimitService } from './quotes-rate-limit.service.js';

interface SessionUser {
  id: string;
  roles: string[];
  locale: string;
}
type CreateForRequestInput = z.infer<typeof CreateQuoteRequestSchema>;
type DirectQuoteInput = z.infer<typeof DirectQuoteRequestSchema>;
type MineQuery = z.infer<typeof QuotesMineQuerySchema>;
type ListQuery = z.infer<typeof CursorPaginationQuerySchema>;
type QuoteDto = z.infer<typeof QuoteSchema>;

const MAX_TOTAL_CENTS = 99_999_999;

function notFound(message = 'Quote not found'): HttpException {
  return new HttpException({ code: 'NOT_FOUND', message }, 404);
}

function conflict(message: string): HttpException {
  return new HttpException({ code: 'CONFLICT', message }, 409);
}

function unprocessable(message: string): HttpException {
  return new HttpException({ code: 'UNPROCESSABLE_ENTITY', message }, 422);
}

function forbidden(message: string): HttpException {
  return new HttpException({ code: 'FORBIDDEN', message }, 403);
}

function resolveLocalizedTitle(title: unknown, locale: string): string {
  const byLocale = title as Record<string, string> | null | undefined;
  const value = byLocale?.[locale] ?? byLocale?.en ?? Object.values(byLocale ?? {})[0];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('quotes: product title has no usable locale value');
  }
  return value;
}

@Injectable()
export class QuotesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QuotesRateLimitService) private readonly rateLimit: QuotesRateLimitService,
    @Inject(QUOTE_EVENTS) private readonly events: QuoteEvents,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  async createForRequest(
    user: SessionUser,
    input: CreateForRequestInput,
    ip: string | undefined,
  ): Promise<QuoteDto> {
    requireRole(user, 'photographer');
    await this.rateLimit.enforceCreate(ip, user.id);

    const profile = await this.requirePhotographerProfile(user.id);

    const request = await this.prisma.client.request.findUnique({
      where: { id: input.requestId },
    });
    if (!request || request.deletedAt) {
      throw notFound('Request not found');
    }
    if (request.clientId === user.id) {
      throw unprocessable('Cannot send a quote on your own request');
    }
    const now = Date.now();
    if (!['open', 'quoted'].includes(request.status) || request.expiresAt.getTime() <= now) {
      throw conflict('Request is not open for quotes');
    }

    const currency = await this.requireProfileCurrency(profile.countryCode);
    if (currency !== request.currency) {
      throw unprocessable("currency must match the request's currency");
    }

    const validUntil = new Date(input.validUntil);
    if (validUntil.getTime() > request.expiresAt.getTime()) {
      throw unprocessable('validUntil must not be after the request expires');
    }

    const totals = await this.computeTotals(input.lineItems);

    const existing = await this.prisma.client.quote.findFirst({
      where: { requestId: input.requestId, photographerId: profile.id, status: 'sent' },
    });
    if (existing) {
      throw conflict('A sent quote already exists for this request');
    }

    const created = await this.prisma.client.$transaction(async (tx) => {
      const claim = await tx.request.updateMany({
        where: {
          id: request.id,
          status: { in: ['open', 'quoted'] },
          expiresAt: { gt: new Date() },
          deletedAt: null,
        },
        data: { status: 'quoted' },
      });
      if (claim.count === 0) {
        throw conflict('Request is not open for quotes');
      }

      let quote: Quote;
      try {
        quote = await tx.quote.create({
          data: {
            requestId: input.requestId,
            photographerId: profile.id,
            clientId: request.clientId,
            lineItems: input.lineItems,
            subtotalCents: totals.subtotalCents,
            platformFeeCents: totals.platformFeeCents,
            totalCents: totals.totalCents,
            feePercent: totals.feePercent,
            licenceUsage: request.usage,
            licenceTextVersion: null,
            currency,
            validUntil,
            message: input.message ?? null,
            status: 'sent',
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw conflict('A sent quote already exists for this request');
        }
        throw error;
      }

      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          action: 'quote.created',
          targetType: 'Quote',
          targetId: quote.id,
          after: { requestId: quote.requestId, totalCents: quote.totalCents },
        },
      });

      return quote;
    });

    await this.events.onCreated(created);

    return mapQuote(created);
  }

  async createDirect(
    user: SessionUser,
    slug: string,
    productId: string,
    input: DirectQuoteInput,
    ip: string | undefined,
  ): Promise<QuoteDto> {
    await this.rateLimit.enforceDirectCreate(ip, user.id);

    const profile = await this.prisma.client.photographerProfile.findUnique({ where: { slug } });
    if (!profile || profile.deletedAt || !profile.isPublished) {
      throw notFound('Photographer profile not found');
    }
    if (profile.userId === user.id) {
      throw unprocessable('Cannot request a direct quote from your own profile');
    }

    const product = await this.prisma.client.product.findUnique({
      where: { id: productId },
      include: { tiers: true },
    });
    if (!product || product.deletedAt || !product.isActive || product.profileId !== profile.id) {
      throw notFound('Product not found');
    }

    const tier = product.tiers.find((candidate) => candidate.id === input.productTierId);
    if (!tier) {
      throw notFound('Product tier not found');
    }

    const currency = await this.requireProfileCurrency(profile.countryCode);
    if (tier.currency !== currency) {
      throw unprocessable("tier currency must match the photographer profile's currency");
    }

    const label = resolveLocalizedTitle(product.title, user.locale);
    const lineItem: LineItem = { label, qty: 1, unitCents: tier.priceCents };
    const totals = await this.computeTotals([lineItem]);

    const validUntil = new Date();
    validUntil.setUTCDate(validUntil.getUTCDate() + 7);

    const created = await this.prisma.client.$transaction(async (tx) => {
      const quote = await tx.quote.create({
        data: {
          photographerId: profile.id,
          clientId: user.id,
          productId: product.id,
          productTierId: tier.id,
          lineItems: [{ ...lineItem }],
          subtotalCents: totals.subtotalCents,
          platformFeeCents: totals.platformFeeCents,
          totalCents: totals.totalCents,
          feePercent: totals.feePercent,
          licenceUsage: tier.usage,
          licenceTextVersion: tier.licenceTextVersion,
          currency,
          validUntil,
          message: input.message ?? null,
          status: 'sent',
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          action: 'quote.created',
          targetType: 'Quote',
          targetId: quote.id,
          after: { productId: quote.productId, totalCents: quote.totalCents },
        },
      });

      return quote;
    });

    await this.events.onCreated(created);

    return mapQuote(created);
  }

  async mine(
    user: SessionUser,
    query: MineQuery,
  ): Promise<{ items: QuoteDto[]; nextCursor: string | null }> {
    const role = query.role ?? (user.roles.includes('photographer') ? 'photographer' : 'client');
    const cursor = query.cursor ? decodeCreatedAtCursor(query.cursor) : undefined;

    let where: Prisma.QuoteWhereInput;
    if (role === 'photographer') {
      const profile = await this.findCallerProfile(user.id);
      if (!profile) {
        return { items: [], nextCursor: null };
      }
      where = { photographerId: profile.id };
    } else {
      where = { clientId: user.id };
    }

    const rows = await this.prisma.client.quote.findMany({
      where: {
        ...where,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
    });

    return this.paginate(rows, query.limit);
  }

  async get(user: SessionUser, id: string): Promise<QuoteDto> {
    const quote = await this.prisma.client.quote.findUnique({ where: { id } });
    if (!quote) {
      throw notFound();
    }
    if (quote.clientId === user.id) {
      return mapQuote(quote);
    }
    const profile = await this.findCallerProfile(user.id);
    if (profile?.id === quote.photographerId) {
      return mapQuote(quote);
    }
    throw notFound();
  }

  async listForRequest(
    user: SessionUser,
    requestId: string,
    query: ListQuery,
  ): Promise<{ items: QuoteDto[]; nextCursor: string | null }> {
    const request = await this.prisma.client.request.findUnique({ where: { id: requestId } });
    if (!request || request.deletedAt) {
      throw notFound('Request not found');
    }
    if (request.clientId !== user.id) {
      throw notFound('Request not found');
    }

    const cursor = query.cursor ? decodeCreatedAtCursor(query.cursor) : undefined;
    const rows = await this.prisma.client.quote.findMany({
      where: {
        requestId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
    });

    return this.paginate(rows, query.limit);
  }

  async accept(user: SessionUser, id: string): Promise<QuoteDto> {
    const quote = await this.prisma.client.quote.findUnique({ where: { id } });
    if (quote?.clientId !== user.id) {
      throw notFound();
    }
    if (quote.status !== 'sent') {
      throw conflict('Quote is not open for acceptance');
    }

    const now = new Date();
    if (quote.validUntil.getTime() <= now.getTime()) {
      await this.prisma.client.quote.updateMany({
        where: { id, status: 'sent' },
        data: { status: 'expired' },
      });
      throw conflict('Quote has expired');
    }

    // A stale direct quote is marked expired and committed rather than
    // thrown from inside the transaction: throwing would roll back that
    // very update, leaving the quote stuck as "sent".
    const result = await this.prisma.client.$transaction(async (tx) => {
      if (!quote.requestId) {
        const stillBookable = await this.directQuoteStillBookable(tx, quote);
        if (!stillBookable) {
          await tx.quote.updateMany({
            where: { id, status: 'sent' },
            data: { status: 'expired' },
          });
          return { ok: false as const };
        }
      }

      if (quote.requestId) {
        const requestUpdate = await tx.request.updateMany({
          where: {
            id: quote.requestId,
            status: { in: ['open', 'quoted'] },
            expiresAt: { gt: now },
          },
          data: { status: 'booked' },
        });
        if (requestUpdate.count === 0) {
          throw conflict('Quote is no longer available');
        }
      }

      const quoteUpdate = await tx.quote.updateMany({
        where: { id, status: 'sent', validUntil: { gt: now } },
        data: { status: 'accepted' },
      });
      if (quoteUpdate.count === 0) {
        throw conflict('Quote is no longer available');
      }

      let siblings: Quote[] = [];
      if (quote.requestId) {
        siblings = await tx.quote.findMany({
          where: { requestId: quote.requestId, status: 'sent' },
        });
        if (siblings.length > 0) {
          await tx.quote.updateMany({
            where: { id: { in: siblings.map((sibling) => sibling.id) } },
            data: { status: 'declined' },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          action: 'quote.accepted',
          targetType: 'Quote',
          targetId: id,
          before: { status: 'sent' },
          after: { status: 'accepted', declinedQuoteIds: siblings.map((sibling) => sibling.id) },
        },
      });

      return {
        ok: true as const,
        quote: await tx.quote.findUniqueOrThrow({ where: { id } }),
        siblings,
      };
    });

    if (!result.ok) {
      throw conflict('The product is no longer available');
    }

    await this.events.onAccepted(result.quote);
    for (const sibling of result.siblings) {
      try {
        await this.events.onDeclined({ ...sibling, status: 'declined' });
      } catch (error) {
        this.logger.error(
          { err: error, quoteId: sibling.id },
          'quotes: failed to notify a sibling quote decline',
        );
      }
    }
    return mapQuote(result.quote);
  }

  async decline(user: SessionUser, id: string): Promise<QuoteDto> {
    const quote = await this.prisma.client.quote.findUnique({ where: { id } });
    if (quote?.clientId !== user.id) {
      throw notFound();
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.quote.updateMany({
        where: { id, status: 'sent' },
        data: { status: 'declined' },
      });
      if (result.count === 0) {
        throw conflict('Quote is not open for decline');
      }
      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          action: 'quote.declined',
          targetType: 'Quote',
          targetId: id,
          before: { status: 'sent' },
          after: { status: 'declined' },
        },
      });
      return tx.quote.findUniqueOrThrow({ where: { id } });
    });

    await this.events.onDeclined(updated);
    return mapQuote(updated);
  }

  async withdraw(user: SessionUser, id: string): Promise<QuoteDto> {
    const quote = await this.prisma.client.quote.findUnique({ where: { id } });
    if (!quote) {
      throw notFound();
    }
    const profile = await this.findCallerProfile(user.id);
    if (quote.photographerId !== profile?.id) {
      throw notFound();
    }

    const updated = await this.prisma.client.$transaction(async (tx) => {
      const result = await tx.quote.updateMany({
        where: { id, status: 'sent' },
        data: { status: 'withdrawn' },
      });
      if (result.count === 0) {
        throw conflict('Quote is not open for withdrawal');
      }
      await tx.auditLog.create({
        data: {
          actorType: 'user',
          actorId: user.id,
          action: 'quote.withdrawn',
          targetType: 'Quote',
          targetId: id,
          before: { status: 'sent' },
          after: { status: 'withdrawn' },
        },
      });
      return tx.quote.findUniqueOrThrow({ where: { id } });
    });

    await this.events.onWithdrawn(updated);
    return mapQuote(updated);
  }

  private paginate(rows: Quote[], limit: number): { items: QuoteDto[]; nextCursor: string | null } {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? encodeCreatedAtCursor(last.createdAt, last.id) : null;
    return { items: page.map(mapQuote), nextCursor };
  }

  private async computeTotals(lineItems: readonly LineItem[]): Promise<{
    subtotalCents: number;
    platformFeeCents: number;
    totalCents: number;
    feePercent: number;
  }> {
    const feePercent = await this.getFeePercent();
    const totals = quoteTotals(lineItems, feePercent);
    if (totals.totalCents === 0) {
      throw unprocessable('The quote total must be greater than zero');
    }
    if (totals.totalCents > MAX_TOTAL_CENTS) {
      throw unprocessable('The quote total exceeds the maximum allowed');
    }
    return { ...totals, feePercent };
  }

  private async findCallerProfile(userId: string) {
    const profile = await this.prisma.client.photographerProfile.findUnique({
      where: { userId },
    });
    return profile && !profile.deletedAt ? profile : null;
  }

  // Re-checked at accept time, inside the transaction, because a direct
  // quote's price is snapshotted at creation (DECISIONS.md D22): the client
  // still accepts at the snapshotted price as long as the tier hasn't been
  // replaced (productTierId set to null on delete) and the profile/product
  // are still published/active.
  private async directQuoteStillBookable(
    tx: Prisma.TransactionClient,
    quote: Quote,
  ): Promise<boolean> {
    if (!quote.productId || !quote.productTierId) {
      return false;
    }
    const profile = await tx.photographerProfile.findUnique({
      where: { id: quote.photographerId },
    });
    if (!profile || profile.deletedAt || !profile.isPublished) {
      return false;
    }
    const product = await tx.product.findUnique({ where: { id: quote.productId } });
    return Boolean(product && !product.deletedAt && product.isActive);
  }

  private async requirePhotographerProfile(userId: string) {
    const profile = await this.findCallerProfile(userId);
    if (!profile) {
      throw notFound('Photographer profile not found');
    }
    if (!profile.isPublished) {
      throw forbidden('A published photographer profile is required to send quotes');
    }
    return profile;
  }

  private async requireProfileCurrency(countryCode: string): Promise<string> {
    const country = await this.prisma.client.country.findUnique({ where: { code: countryCode } });
    if (!country) {
      throw new Error(`quotes: profile country "${countryCode}" is missing from Country`);
    }
    return country.currency;
  }

  private async getFeePercent(): Promise<number> {
    const setting = await this.prisma.client.platformSetting.findUnique({
      where: { key: 'feePercent' },
    });
    const value = setting?.value;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error('quotes: PlatformSetting "feePercent" is missing or invalid');
    }
    return value;
  }
}
