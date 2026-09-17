import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { createQuoteExpiryProcessor } from './quote-expiry.processor.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

function fakeLogger() {
  return { log: () => undefined, warn: () => undefined, error: () => undefined };
}

function fakeNotifyQueue() {
  return { add: () => Promise.resolve(undefined) };
}

describe('createQuoteExpiryProcessor against a real database', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL is not set', () => undefined);
    return;
  }

  let prisma: PrismaClient;
  const runId = randomUUID().replaceAll('-', '').slice(0, 8);
  let clientId: string;
  let photographerUserId: string;
  let profileId: string;
  let requestId: string;
  let quoteId: string;
  let bookedRequestId: string;
  let bookedQuoteId: string;
  let cancelledRequestId: string;
  let cancelledLingeringQuoteId: string;
  let deletedRequestId: string;

  beforeAll(async () => {
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

    const client = await prisma.user.create({
      data: {
        email: `quote-expiry-${runId}@photoo.test`,
        emailVerifiedAt: new Date(),
        name: `Fx Quote Expiry ${runId}`,
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'active',
      },
    });
    clientId = client.id;

    const photographerUser = await prisma.user.create({
      data: {
        email: `quote-expiry-photographer-${runId}@photoo.test`,
        emailVerifiedAt: new Date(),
        name: `Fx Quote Expiry Photographer ${runId}`,
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'active',
      },
    });
    photographerUserId = photographerUser.id;

    const profile = await prisma.photographerProfile.create({
      data: {
        userId: photographerUser.id,
        slug: `fx-quote-expiry-${runId}`,
        displayName: `Fx Quote Expiry Photographer ${runId}`,
        bio: {},
        links: { other: [] },
        categories: ['wedding'],
        languages: ['en'],
        city: `Fx Quote Expiry City ${runId}`,
        countryCode: 'LU',
      },
    });
    profileId = profile.id;

    const longPast = new Date('2000-01-01T00:00:00.000Z');
    const request = await prisma.request.create({
      data: {
        clientId: client.id,
        title: `Fx Quote Expiry Request ${runId}`,
        category: 'wedding',
        description: 'Fixture request for the quote-expiry sweep.',
        eventDate: longPast,
        dateFlexible: false,
        address: { line1: '1 Fixture Way', city: 'Fixture City', postalCode: 'L-1000' },
        city: 'Fixture City',
        countryCode: 'LU',
        budgetMinCents: 100000,
        budgetMaxCents: 200000,
        currency: 'EUR',
        usage: 'personal',
        status: 'open',
        expiresAt: longPast,
      },
    });
    requestId = request.id;

    const quote = await prisma.quote.create({
      data: {
        requestId: request.id,
        photographerId: profile.id,
        clientId: client.id,
        lineItems: [{ label: 'Coverage', qty: 1, unitCents: 50000 }],
        subtotalCents: 50000,
        platformFeeCents: 2500,
        totalCents: 50000,
        feePercent: 5,
        licenceUsage: 'personal',
        currency: 'EUR',
        validUntil: longPast,
        status: 'sent',
      },
    });
    quoteId = quote.id;

    const futureValidUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const bookedRequest = await prisma.request.create({
      data: {
        clientId: client.id,
        title: `Fx Quote Expiry Booked Request ${runId}`,
        category: 'wedding',
        description: 'Booked request that the sweep must leave alone.',
        eventDate: longPast,
        dateFlexible: false,
        address: { line1: '1 Fixture Way', city: 'Fixture City', postalCode: 'L-1000' },
        city: 'Fixture City',
        countryCode: 'LU',
        budgetMinCents: 100000,
        budgetMaxCents: 200000,
        currency: 'EUR',
        usage: 'personal',
        status: 'booked',
        expiresAt: longPast,
      },
    });
    bookedRequestId = bookedRequest.id;

    const bookedQuote = await prisma.quote.create({
      data: {
        requestId: bookedRequest.id,
        photographerId: profile.id,
        clientId: client.id,
        lineItems: [{ label: 'Coverage', qty: 1, unitCents: 50000 }],
        subtotalCents: 50000,
        platformFeeCents: 2500,
        totalCents: 50000,
        feePercent: 5,
        licenceUsage: 'personal',
        currency: 'EUR',
        validUntil: futureValidUntil,
        status: 'accepted',
      },
    });
    bookedQuoteId = bookedQuote.id;

    const cancelledRequest = await prisma.request.create({
      data: {
        clientId: client.id,
        title: `Fx Quote Expiry Cancelled Request ${runId}`,
        category: 'wedding',
        description: 'Cancelled request with a lingering sent quote.',
        eventDate: longPast,
        dateFlexible: false,
        address: { line1: '1 Fixture Way', city: 'Fixture City', postalCode: 'L-1000' },
        city: 'Fixture City',
        countryCode: 'LU',
        budgetMinCents: 100000,
        budgetMaxCents: 200000,
        currency: 'EUR',
        usage: 'personal',
        status: 'cancelled',
        expiresAt: longPast,
      },
    });
    cancelledRequestId = cancelledRequest.id;

    const cancelledLingeringQuote = await prisma.quote.create({
      data: {
        requestId: cancelledRequest.id,
        photographerId: profile.id,
        clientId: client.id,
        lineItems: [{ label: 'Coverage', qty: 1, unitCents: 50000 }],
        subtotalCents: 50000,
        platformFeeCents: 2500,
        totalCents: 50000,
        feePercent: 5,
        licenceUsage: 'personal',
        currency: 'EUR',
        validUntil: futureValidUntil,
        status: 'sent',
      },
    });
    cancelledLingeringQuoteId = cancelledLingeringQuote.id;

    const deletedRequest = await prisma.request.create({
      data: {
        clientId: client.id,
        title: `Fx Quote Expiry Deleted Request ${runId}`,
        category: 'wedding',
        description: 'Soft-deleted request the sweep must not close.',
        eventDate: longPast,
        dateFlexible: false,
        address: { line1: '1 Fixture Way', city: 'Fixture City', postalCode: 'L-1000' },
        city: 'Fixture City',
        countryCode: 'LU',
        budgetMinCents: 100000,
        budgetMaxCents: 200000,
        currency: 'EUR',
        usage: 'personal',
        status: 'open',
        expiresAt: longPast,
        deletedAt: new Date(),
      },
    });
    deletedRequestId = deletedRequest.id;
  });

  afterAll(async () => {
    await prisma.quote.deleteMany({
      where: { id: { in: [quoteId, bookedQuoteId, cancelledLingeringQuoteId] } },
    });
    await prisma.request.deleteMany({
      where: { id: { in: [requestId, bookedRequestId, cancelledRequestId, deletedRequestId] } },
    });
    await prisma.photographerProfile.deleteMany({ where: { id: profileId } });
    await prisma.notification.deleteMany({
      where: { userId: { in: [clientId, photographerUserId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [clientId, photographerUserId] } } });
    await prisma.$disconnect();
  });

  it('expires the quote, closes the request, and is idempotent on a second run', async () => {
    const processor = createQuoteExpiryProcessor({
      prisma: { client: prisma },
      notifyQueue: fakeNotifyQueue(),
      logger: fakeLogger() as never,
    });

    await processor(undefined as never);

    const quoteAfterFirstRun = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    const requestAfterFirstRun = await prisma.request.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(quoteAfterFirstRun.status).toBe('expired');
    expect(requestAfterFirstRun.status).toBe('closed');

    const notifications = await prisma.notification.findMany({
      where: { userId: { in: [clientId, photographerUserId] }, type: 'quote_expired' },
    });
    const forThisQuote = notifications.filter(
      (n) => (n.payload as { quoteId?: string }).quoteId === quoteId,
    );
    expect(forThisQuote).toHaveLength(2);
    expect(forThisQuote.map((n) => n.userId).sort()).toEqual([clientId, photographerUserId].sort());

    await processor(undefined as never);

    const quoteAfterSecondRun = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
    const requestAfterSecondRun = await prisma.request.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(quoteAfterSecondRun.status).toBe('expired');
    expect(requestAfterSecondRun.status).toBe('closed');

    const notificationsAfterSecondRun = await prisma.notification.findMany({
      where: { userId: { in: [clientId, photographerUserId] }, type: 'quote_expired' },
    });
    expect(
      notificationsAfterSecondRun.filter(
        (n) => (n.payload as { quoteId?: string }).quoteId === quoteId,
      ),
    ).toHaveLength(2);
  });

  it('expires a sent quote whose request is already cancelled, without touching the request', async () => {
    const processor = createQuoteExpiryProcessor({
      prisma: { client: prisma },
      notifyQueue: fakeNotifyQueue(),
      logger: fakeLogger() as never,
    });

    await processor(undefined as never);

    const quote = await prisma.quote.findUniqueOrThrow({
      where: { id: cancelledLingeringQuoteId },
    });
    const request = await prisma.request.findUniqueOrThrow({ where: { id: cancelledRequestId } });
    expect(quote.status).toBe('expired');
    expect(request.status).toBe('cancelled');
  });

  it('leaves an already-accepted quote alone and creates no notification for it, closing the accept-vs-expiry race', async () => {
    const processor = createQuoteExpiryProcessor({
      prisma: { client: prisma },
      notifyQueue: fakeNotifyQueue(),
      logger: fakeLogger() as never,
    });

    await processor(undefined as never);

    const quote = await prisma.quote.findUniqueOrThrow({ where: { id: bookedQuoteId } });
    const request = await prisma.request.findUniqueOrThrow({ where: { id: bookedRequestId } });
    expect(quote.status).toBe('accepted');
    expect(request.status).toBe('booked');

    const notifications = await prisma.notification.findMany({
      where: { userId: { in: [clientId, photographerUserId] }, type: 'quote_expired' },
    });
    expect(
      notifications.some((n) => (n.payload as { quoteId?: string }).quoteId === bookedQuoteId),
    ).toBe(false);
  });

  it('leaves a soft-deleted, expired request open instead of closing it', async () => {
    const processor = createQuoteExpiryProcessor({
      prisma: { client: prisma },
      notifyQueue: fakeNotifyQueue(),
      logger: fakeLogger() as never,
    });

    await processor(undefined as never);

    const request = await prisma.request.findUniqueOrThrow({ where: { id: deletedRequestId } });
    expect(request.status).toBe('open');
  });
});
