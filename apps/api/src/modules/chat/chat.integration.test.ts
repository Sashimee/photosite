import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createPrismaClient, type PrismaClient } from '@photoo/db';
import { Redis } from 'ioredis';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module.js';
import { configureApp } from '../../bootstrap/configure-app.js';
import { createFastifyAdapter } from '../../bootstrap/fastify-adapter.js';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { TestEmailWorkerModule } from '../../testing/test-email-worker.module.js';
import { waitForLinkInEmail } from '../../testing/mailpit.js';
import { requireIntegrationEnv } from '../../testing/require-integration-env.js';
import { TEST_ENV } from '../../testing/test-env.js';
import { CHAT_CLOCK } from './chat-clock.js';
import { RedisIoAdapter } from './socket-io-redis-adapter.js';

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('waitFor: condition was never met');
}

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL', 'REDIS_URL']);
const PASSWORD = `photoo-test-${randomUUID()}`;
const AUTH_FAKE_IP = '10.50.7.1';
// Distinct from the default injected remote address (127.0.0.1), which
// uploads.integration.test.ts and other suites' fixtures also use: sharing
// it would let this file's upload creations tip their IP rate limit over
// when the whole workspace's tests run together (issue #50).
const UPLOADS_FAKE_IP = '10.50.7.2';

function extractFragmentToken(link: string): string | null {
  const hashIndex = link.indexOf('#token=');
  if (hashIndex === -1) return null;
  return decodeURIComponent(link.slice(hashIndex + '#token='.length));
}

function uniqueEmail(label: string): string {
  return `chat-${label}-${randomUUID()}@photoo.test`;
}

interface MessageBody {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  attachments: { id: string; kind: string; mimeType: string; sizeBytes: number }[];
  deletedAt: string | null;
}

interface ConversationParticipantBody {
  userId: string;
  user: { id: string; displayName: string | null; avatarUrl: string | null };
  lastReadAt: string | null;
}

interface ConversationBody {
  id: string;
  subjectId: string | null;
  subjectRef: { type: 'quote'; quoteId: string; requestTitle?: string } | null;
  participants: ConversationParticipantBody[];
  unreadCount: number;
  archivedByMe: boolean;
  lastMessagePreview: string | null;
}

interface UnreadCountBody {
  count: number;
}

interface PaginatedBody<T> {
  items: T[];
  nextCursor: string | null;
}

async function createChatTestApp(
  env: Env,
): Promise<{ app: NestFastifyApplication; baseUrl: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, TestEmailWorkerModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(env)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(env.TRUSTED_PROXIES),
  );
  await configureApp(app, env);
  const redisIoAdapter = new RedisIoAdapter(app, env.REDIS_URL);
  redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, baseUrl: `http://127.0.0.1:${String(port)}` };
}

describe('chat integration', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let baseUrl: string;
  let prisma: PrismaClient;
  let redis: Redis;
  const createdUserIds: string[] = [];
  const createdConversationIds: string[] = [];
  const createdUploadIds: string[] = [];
  const createdQuoteIds: string[] = [];
  const createdRequestIds: string[] = [];
  const sockets: ClientSocket[] = [];

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  // Scoped to this file's own fake IPs, never a bare `rate-limit:auth:*` or
  // `rate-limit:uploads:*` glob: that would also reset another suite's
  // counters running concurrently against the same Redis (issue #50).
  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [
      `rate-limit:auth:*:${AUTH_FAKE_IP}`,
      `lockout:auth:*:${AUTH_FAKE_IP}`,
      `rate-limit:uploads:*:${UPLOADS_FAKE_IP}`,
      `lockout:uploads:*:${UPLOADS_FAKE_IP}`,
      // No other suite opens real socket connections or sends chat messages,
      // so these globs are safe to clear unscoped (issue #50's concern
      // doesn't apply here). Without this, the per-IP message counter (every
      // REST message send in this file shares the default 127.0.0.1) keeps
      // accumulating across tests instead of resetting each `afterEach`, and
      // "limits to 30 messages a minute per user" alone spends 31 of its 100
      // per-minute budget: under contention, later tests' own message sends
      // can silently 429 (never asserted on) once the shared counter tips
      // over, leaving a conversation's lastMessageAt unset and making the
      // pagination order look like a tiebreak flip (issue #97).
      'rate-limit:chat:socket:connect:ip:*',
      'lockout:chat:socket:connect:ip:*',
      'rate-limit:chat:message:*',
      'lockout:chat:message:*',
    ];
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    if (globbed.length > 0) {
      await redis.del(...globbed);
    }
  }

  function authHeaders(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function signUpAndSignIn(
    roles: readonly string[],
    label: string,
  ): Promise<{ token: string; id: string; cookie: string; email: string }> {
    const email = uniqueEmail(label);
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: AUTH_FAKE_IP,
      payload: { email, password: PASSWORD, roles, locale: 'en' },
    });
    const userId = signUpResponse.json<{ user: { id: string } }>().user.id;
    createdUserIds.push(userId);

    const link = await waitForLinkInEmail(email, /https?:\/\/\S*verify-email#token=\S+/);
    const token = extractFragmentToken(link);
    if (!token) throw new Error(`no token found in verification link: ${link}`);
    await fastify().inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      remoteAddress: AUTH_FAKE_IP,
      payload: { token },
    });

    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: AUTH_FAKE_IP,
      payload: { email, password: PASSWORD },
    });
    const body = signInResponse.json<{ user: { id: string }; session: { token: string } }>();
    const cookie = signInResponse.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    return { token: body.session.token, id: body.user.id, cookie, email };
  }

  async function createConversation(userAId: string, userBId: string): Promise<string> {
    const conversation = await prisma.conversation.create({
      data: {
        type: 'quote',
        subjectId: randomUUID(),
        participants: { create: [{ userId: userAId }, { userId: userBId }] },
      },
    });
    createdConversationIds.push(conversation.id);
    return conversation.id;
  }

  async function createPhotographerProfileDirect(userId: string, suffix: string): Promise<string> {
    const profile = await prisma.photographerProfile.create({
      data: {
        userId,
        slug: `fx-chat-photog-${suffix}`,
        displayName: `Fx Chat Photog ${suffix}`,
        bio: {},
        links: {},
        categories: ['wedding'],
        languages: ['en'],
        city: 'Luxembourg',
        countryCode: 'LU',
      },
    });
    return profile.id;
  }

  async function createRequestFixture(
    clientId: string,
    suffix: string,
  ): Promise<{ id: string; title: string }> {
    const eventDate = new Date();
    eventDate.setUTCDate(eventDate.getUTCDate() + 30);
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 60);
    const title = `Fx Chat Request ${suffix}`;
    const request = await prisma.request.create({
      data: {
        clientId,
        title,
        category: 'wedding',
        description: 'Fixture request for chat subjectRef tests.',
        eventDate,
        dateFlexible: false,
        address: {
          line1: '1 Fixture Way',
          city: 'Luxembourg',
          postalCode: 'L-1000',
          countryCode: 'LU',
        },
        city: 'Luxembourg',
        countryCode: 'LU',
        budgetMinCents: 100000,
        budgetMaxCents: 200000,
        currency: 'EUR',
        usage: 'personal',
        status: 'open',
        expiresAt,
      },
    });
    createdRequestIds.push(request.id);
    return { id: request.id, title };
  }

  async function createProductFixture(profileId: string, suffix: string): Promise<string> {
    const product = await prisma.product.create({
      data: {
        profileId,
        title: { en: `Fx Chat Product ${suffix}` },
        category: 'wedding',
        durationMinutes: 120,
        deliverables: { photos: 50 },
        basePriceCents: 50000,
        currency: 'EUR',
        order: 0,
      },
    });
    return product.id;
  }

  // `Quote_request_or_product_check` requires requestId or productId, and
  // `Quote_totalCents_eq_subtotalCents_check` requires totalCents to equal
  // subtotalCents (the fee comes out of the photographer's share, not on
  // top of what the client pays).
  async function createQuoteFixture(params: {
    photographerId: string;
    clientId: string;
    requestId: string | null;
    productId?: string | null;
  }): Promise<string> {
    const validUntil = new Date();
    validUntil.setUTCDate(validUntil.getUTCDate() + 5);
    const quote = await prisma.quote.create({
      data: {
        requestId: params.requestId,
        photographerId: params.photographerId,
        clientId: params.clientId,
        productId: params.productId ?? null,
        lineItems: [{ label: 'Coverage', qty: 1, unitCents: 50000 }],
        subtotalCents: 50000,
        platformFeeCents: 2500,
        totalCents: 50000,
        feePercent: 5,
        licenceUsage: 'personal',
        currency: 'EUR',
        validUntil,
        status: 'sent',
      },
    });
    createdQuoteIds.push(quote.id);
    return quote.id;
  }

  async function createQuoteConversationFixture(
    quoteId: string,
    clientId: string,
    photographerUserId: string,
  ): Promise<string> {
    const conversation = await prisma.conversation.create({
      data: {
        type: 'quote',
        subjectId: quoteId,
        participants: { create: [{ userId: clientId }, { userId: photographerUserId }] },
      },
    });
    createdConversationIds.push(conversation.id);
    return conversation.id;
  }

  async function createCleanChatAttachment(ownerToken: string): Promise<string> {
    const createResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/uploads',
      remoteAddress: UPLOADS_FAKE_IP,
      headers: authHeaders(ownerToken),
      payload: { purpose: 'chat_attachment', mimeType: 'image/jpeg', sizeBytes: 1024 },
    });
    if (createResponse.statusCode !== 201) {
      throw new Error(
        `upload create failed: ${String(createResponse.statusCode)} ${createResponse.body}`,
      );
    }
    const created = createResponse.json<{
      uploadId: string;
      url: string;
      headers: Record<string, string>;
    }>();
    createdUploadIds.push(created.uploadId);
    const buffer = Buffer.alloc(1024, 3);
    await fetch(created.url, { method: 'PUT', body: buffer, headers: created.headers });
    await fastify().inject({
      method: 'POST',
      url: `/v1/uploads/${created.uploadId}/complete`,
      headers: authHeaders(ownerToken),
    });
    await prisma.upload.update({
      where: { id: created.uploadId },
      data: { status: 'clean', virusScanStatus: 'clean' },
    });
    return created.uploadId;
  }

  function connectSocket(options: {
    cookie?: string;
    token?: string;
    origin?: string;
  }): Promise<ClientSocket> {
    const extraHeaders: Record<string, string> = {};
    if (options.cookie) extraHeaders.cookie = options.cookie;
    if (options.origin) extraHeaders.origin = options.origin;

    const socket = io(baseUrl, {
      path: '/v1/socket.io',
      transports: ['polling'],
      forceNew: true,
      reconnection: false,
      extraHeaders,
      auth: options.token ? { token: options.token } : {},
    });
    sockets.push(socket);

    return new Promise((resolve, reject) => {
      socket.once('connect', () => {
        resolve(socket);
      });
      socket.once('connect_error', (error: Error) => {
        reject(error);
      });
    });
  }

  function emitWithAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => {
      socket.emit(event, payload, (response: T) => {
        resolve(response);
      });
    });
  }

  async function fetchAllPages<T>(
    fetchPage: (cursor: string | null) => Promise<PaginatedBody<T>>,
  ): Promise<{ items: T[]; pages: number }> {
    const items: T[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (;;) {
      const page: PaginatedBody<T> = await fetchPage(cursor);
      items.push(...page.items);
      cursor = page.nextCursor;
      pages += 1;
      if (!cursor || pages >= 10) break;
    }
    return { items, pages };
  }

  beforeAll(async () => {
    const env: Env = {
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    };
    const created = await createChatTestApp(env);
    app = created.app;
    baseUrl = created.baseUrl;
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    redis = new Redis(testEnv.REDIS_URL);
    await clearRateLimitKeys();
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    if (createdConversationIds.length > 0) {
      await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
    }
    if (createdQuoteIds.length > 0) {
      await prisma.quote.deleteMany({ where: { id: { in: createdQuoteIds } } });
    }
    if (createdRequestIds.length > 0) {
      await prisma.request.deleteMany({ where: { id: { in: createdRequestIds } } });
    }
    if (createdUploadIds.length > 0) {
      await prisma.upload.deleteMany({ where: { id: { in: createdUploadIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  describe('REST: membership and 404s', () => {
    it('gives a non-participant 404 on get, messages, send, read, archive and report', async () => {
      const client = await signUpAndSignIn(['client'], 'membership-client');
      const photographer = await signUpAndSignIn(['photographer'], 'membership-photog');
      const outsider = await signUpAndSignIn(['client'], 'membership-outsider');
      const conversationId = await createConversation(client.id, photographer.id);

      const outsiderHeaders = authHeaders(outsider.token);
      const get = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}`,
        headers: outsiderHeaders,
      });
      expect(get.statusCode).toBe(404);

      const messages = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: outsiderHeaders,
      });
      expect(messages.statusCode).toBe(404);

      const send = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: outsiderHeaders,
        payload: { body: 'hello' },
      });
      expect(send.statusCode).toBe(404);

      const read = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/read`,
        headers: outsiderHeaders,
        payload: { upToMessageId: randomUUID() },
      });
      expect(read.statusCode).toBe(404);

      const archive = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/archive`,
        headers: outsiderHeaders,
      });
      expect(archive.statusCode).toBe(404);

      const report = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/report`,
        headers: outsiderHeaders,
        payload: { reason: 'spam' },
      });
      expect(report.statusCode).toBe(404);
    });

    it('gives a non-existent conversation 404, same as a non-participant', async () => {
      const client = await signUpAndSignIn(['client'], 'missing-conv');
      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${randomUUID()}`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('messages, unread count and read', () => {
    it('sends a message, lists it, and updates unread count until marked read', async () => {
      const client = await signUpAndSignIn(['client'], 'unread-client');
      const photographer = await signUpAndSignIn(['photographer'], 'unread-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      const send = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'Hi there' },
      });
      expect(send.statusCode).toBe(201);
      const message = send.json<MessageBody>();
      expect(message.body).toBe('Hi there');

      const listAsPhotographer = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(photographer.token),
      });
      expect(listAsPhotographer.statusCode).toBe(200);
      expect(listAsPhotographer.json<PaginatedBody<MessageBody>>().items).toHaveLength(1);

      const conversationAsPhotographer = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}`,
        headers: authHeaders(photographer.token),
      });
      const beforeRead = conversationAsPhotographer.json<ConversationBody>();
      expect(beforeRead.unreadCount).toBe(1);
      expect(beforeRead.lastMessagePreview).toBe('Hi there');

      const read = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/read`,
        headers: authHeaders(photographer.token),
        payload: { upToMessageId: message.id },
      });
      expect(read.statusCode).toBe(200);
      expect(read.json<ConversationBody>().unreadCount).toBe(0);
    });

    it('rejects a message with neither body nor attachments with a validation error', async () => {
      const client = await signUpAndSignIn(['client'], 'validation-client');
      const photographer = await signUpAndSignIn(['photographer'], 'validation-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('attachments', () => {
    it('attaches a clean upload owned by the sender', async () => {
      const client = await signUpAndSignIn(['client'], 'attach-client');
      const photographer = await signUpAndSignIn(['photographer'], 'attach-photog');
      const conversationId = await createConversation(client.id, photographer.id);
      const uploadId = await createCleanChatAttachment(client.token);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { attachmentIds: [uploadId] },
      });
      expect(response.statusCode).toBe(201);
      const message = response.json<MessageBody>();
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0]?.kind).toBe('image');

      const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
      expect(message.attachments[0]?.mimeType).toBe(upload.mimeType);
      expect(message.attachments[0]?.sizeBytes).toBe(
        upload.actualSizeBytes ?? upload.declaredSizeBytes,
      );
    });

    it('rejects an attachment owned by someone else with 422', async () => {
      const client = await signUpAndSignIn(['client'], 'attach-foreign-client');
      const photographer = await signUpAndSignIn(['photographer'], 'attach-foreign-photog');
      const conversationId = await createConversation(client.id, photographer.id);
      const uploadId = await createCleanChatAttachment(photographer.token);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { attachmentIds: [uploadId] },
      });
      expect(response.statusCode).toBe(422);
    });

    it('rejects an attachment that has not finished scanning with 422', async () => {
      const client = await signUpAndSignIn(['client'], 'attach-unclean-client');
      const photographer = await signUpAndSignIn(['photographer'], 'attach-unclean-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      const createResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/uploads',
        remoteAddress: UPLOADS_FAKE_IP,
        headers: authHeaders(client.token),
        payload: { purpose: 'chat_attachment', mimeType: 'image/jpeg', sizeBytes: 512 },
      });
      const created = createResponse.json<{ uploadId: string }>();
      createdUploadIds.push(created.uploadId);

      const response = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { attachmentIds: [created.uploadId] },
      });
      expect(response.statusCode).toBe(422);
    });

    it('issues a presigned download URL for a participant, and 404s a non-participant', async () => {
      const client = await signUpAndSignIn(['client'], 'attach-download-client');
      const photographer = await signUpAndSignIn(['photographer'], 'attach-download-photog');
      const outsider = await signUpAndSignIn(['client'], 'attach-download-outsider');
      const conversationId = await createConversation(client.id, photographer.id);
      const uploadId = await createCleanChatAttachment(client.token);

      const send = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { attachmentIds: [uploadId] },
      });
      const message = send.json<MessageBody>();
      const attachmentId = message.attachments[0]?.id;
      if (!attachmentId) throw new Error('expected the sent message to carry an attachment');

      const download = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}/messages/${message.id}/attachments/${attachmentId}/download`,
        headers: authHeaders(photographer.token),
      });
      expect(download.statusCode).toBe(200);
      const downloadBody = download.json<{ url: string; expiresAt: string }>();
      expect(downloadBody.url).toMatch(/^https?:\/\//);

      const outsiderDownload = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}/messages/${message.id}/attachments/${attachmentId}/download`,
        headers: authHeaders(outsider.token),
      });
      expect(outsiderDownload.statusCode).toBe(404);
    });

    it('refuses to download an attachment that has not finished scanning', async () => {
      const client = await signUpAndSignIn(['client'], 'attach-download-unclean-client');
      const photographer = await signUpAndSignIn(
        ['photographer'],
        'attach-download-unclean-photog',
      );
      const conversationId = await createConversation(client.id, photographer.id);

      const createResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/uploads',
        remoteAddress: UPLOADS_FAKE_IP,
        headers: authHeaders(client.token),
        payload: { purpose: 'chat_attachment', mimeType: 'image/jpeg', sizeBytes: 512 },
      });
      const created = createResponse.json<{ uploadId: string }>();
      createdUploadIds.push(created.uploadId);
      const pendingMessage = await prisma.message.create({
        data: { conversationId, senderId: client.id, body: 'pending scan' },
      });
      await prisma.messageAttachment.create({
        data: { messageId: pendingMessage.id, uploadId: created.uploadId },
      });
      const messageWithAttachment = await prisma.message.findUniqueOrThrow({
        where: { id: pendingMessage.id },
        include: { attachments: true },
      });
      const attachmentId = messageWithAttachment.attachments[0]?.id;
      if (!attachmentId) throw new Error('expected the fixture message to carry an attachment');

      const download = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}/messages/${messageWithAttachment.id}/attachments/${attachmentId}/download`,
        headers: authHeaders(photographer.token),
      });
      expect(download.statusCode).toBe(409);
    });

    it('returns 404 for an attachment on a message the sender has deleted', async () => {
      const client = await signUpAndSignIn(['client'], 'attach-download-deleted-client');
      const photographer = await signUpAndSignIn(
        ['photographer'],
        'attach-download-deleted-photog',
      );
      const conversationId = await createConversation(client.id, photographer.id);
      const uploadId = await createCleanChatAttachment(client.token);

      const send = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { attachmentIds: [uploadId] },
      });
      const message = send.json<MessageBody>();
      const attachmentId = message.attachments[0]?.id;
      if (!attachmentId) throw new Error('expected the sent message to carry an attachment');

      const deleteResponse = await fastify().inject({
        method: 'DELETE',
        url: `/v1/conversations/${conversationId}/messages/${message.id}`,
        headers: authHeaders(client.token),
      });
      expect(deleteResponse.statusCode).toBe(200);

      const download = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}/messages/${message.id}/attachments/${attachmentId}/download`,
        headers: authHeaders(photographer.token),
      });
      expect(download.statusCode).toBe(404);
    });
  });

  describe('delete window', () => {
    it('lets the sender delete their own message within 15 minutes', async () => {
      const client = await signUpAndSignIn(['client'], 'delete-client');
      const photographer = await signUpAndSignIn(['photographer'], 'delete-photog');
      const conversationId = await createConversation(client.id, photographer.id);
      const send = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'delete me' },
      });
      const message = send.json<MessageBody>();

      const response = await fastify().inject({
        method: 'DELETE',
        url: `/v1/conversations/${conversationId}/messages/${message.id}`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<MessageBody>().body).toBeNull();
      expect(response.json<MessageBody>().deletedAt).not.toBeNull();
    });

    it('refuses to delete a message once the 15-minute window has passed', async () => {
      const client = await signUpAndSignIn(['client'], 'delete-late-client');
      const photographer = await signUpAndSignIn(['photographer'], 'delete-late-photog');
      const conversationId = await createConversation(client.id, photographer.id);
      const send = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'too late' },
      });
      const message = send.json<MessageBody>();
      await prisma.message.update({
        where: { id: message.id },
        data: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
      });

      const response = await fastify().inject({
        method: 'DELETE',
        url: `/v1/conversations/${conversationId}/messages/${message.id}`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(409);
    });

    it('refuses to let another participant delete a message that is not theirs', async () => {
      const client = await signUpAndSignIn(['client'], 'delete-other-client');
      const photographer = await signUpAndSignIn(['photographer'], 'delete-other-photog');
      const conversationId = await createConversation(client.id, photographer.id);
      const send = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'not yours' },
      });
      const message = send.json<MessageBody>();

      const response = await fastify().inject({
        method: 'DELETE',
        url: `/v1/conversations/${conversationId}/messages/${message.id}`,
        headers: authHeaders(photographer.token),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('archive and unarchive', () => {
    it('hides an archived conversation from the default list, and a new message unarchives it for the recipient', async () => {
      const client = await signUpAndSignIn(['client'], 'archive-client');
      const photographer = await signUpAndSignIn(['photographer'], 'archive-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      const archive = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/archive`,
        headers: authHeaders(photographer.token),
      });
      expect(archive.statusCode).toBe(200);
      expect(archive.json<ConversationBody>().archivedByMe).toBe(true);

      const listActive = await fastify().inject({
        method: 'GET',
        url: '/v1/conversations',
        headers: authHeaders(photographer.token),
      });
      const activeIds = listActive.json<PaginatedBody<ConversationBody>>().items.map((c) => c.id);
      expect(activeIds).not.toContain(conversationId);

      const listArchived = await fastify().inject({
        method: 'GET',
        url: '/v1/conversations?archived=true',
        headers: authHeaders(photographer.token),
      });
      const archivedIds = listArchived
        .json<PaginatedBody<ConversationBody>>()
        .items.map((c) => c.id);
      expect(archivedIds).toContain(conversationId);

      await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'still there?' },
      });

      const listAfterMessage = await fastify().inject({
        method: 'GET',
        url: '/v1/conversations',
        headers: authHeaders(photographer.token),
      });
      const idsAfterMessage = listAfterMessage
        .json<PaginatedBody<ConversationBody>>()
        .items.map((c) => c.id);
      expect(idsAfterMessage).toContain(conversationId);
    });

    it('unarchives a conversation through the dedicated endpoint', async () => {
      const client = await signUpAndSignIn(['client'], 'unarchive-client');
      const photographer = await signUpAndSignIn(['photographer'], 'unarchive-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/archive`,
        headers: authHeaders(client.token),
      });
      const unarchive = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/unarchive`,
        headers: authHeaders(client.token),
      });
      expect(unarchive.statusCode).toBe(200);
      expect(unarchive.json<ConversationBody>().archivedByMe).toBe(false);
    });
  });

  describe('report', () => {
    it('writes an AuditLog row for a participant report and rate limits after 5 an hour', async () => {
      const client = await signUpAndSignIn(['client'], 'report-client');
      const photographer = await signUpAndSignIn(['photographer'], 'report-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      const first = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/report`,
        headers: authHeaders(client.token),
        payload: { reason: 'Inappropriate messages' },
      });
      expect(first.statusCode).toBe(204);

      const log = await prisma.auditLog.findFirst({
        where: { targetType: 'Conversation', targetId: conversationId, action: 'chat.reported' },
      });
      expect(log).not.toBeNull();
      expect(log?.actorId).toBe(client.id);

      for (let i = 0; i < 4; i += 1) {
        await fastify().inject({
          method: 'POST',
          url: `/v1/conversations/${conversationId}/report`,
          headers: authHeaders(client.token),
          payload: { reason: `Repeat ${String(i)}` },
        });
      }
      const overflow = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/report`,
        headers: authHeaders(client.token),
        payload: { reason: 'One too many' },
      });
      expect(overflow.statusCode).toBe(429);
    });
  });

  describe('rate limit: messages', () => {
    it('limits to 30 messages a minute per user, over REST', async () => {
      const client = await signUpAndSignIn(['client'], 'msg-rate-client');
      const photographer = await signUpAndSignIn(['photographer'], 'msg-rate-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      for (let i = 0; i < 30; i += 1) {
        const response = await fastify().inject({
          method: 'POST',
          url: `/v1/conversations/${conversationId}/messages`,
          headers: authHeaders(client.token),
          payload: { body: `message ${String(i)}` },
        });
        expect(response.statusCode).toBe(201);
      }
      const overflow = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'one too many' },
      });
      expect(overflow.statusCode).toBe(429);
    });
  });

  describe('socket handshake', () => {
    it('rejects a connection with no session', async () => {
      await expect(connectSocket({})).rejects.toBeTruthy();
    });

    it('rejects a connection with an invalid bearer token', async () => {
      await expect(connectSocket({ token: 'not-a-real-token' })).rejects.toBeTruthy();
    });

    it('rejects a connection from a disallowed origin', async () => {
      const user = await signUpAndSignIn(['client'], 'origin-reject');
      await expect(
        connectSocket({ cookie: user.cookie, origin: 'https://evil.example' }),
      ).rejects.toBeTruthy();
    });

    it('accepts a connection with a valid session cookie from an allowed origin', async () => {
      const user = await signUpAndSignIn(['client'], 'cookie-accept');
      const socket = await connectSocket({ cookie: user.cookie, origin: 'http://localhost:3000' });
      expect(socket.connected).toBe(true);
    });

    it('accepts a connection with a valid bearer token and no origin header', async () => {
      const user = await signUpAndSignIn(['client'], 'bearer-accept');
      const socket = await connectSocket({ token: user.token });
      expect(socket.connected).toBe(true);
    });
  });

  describe('socket: membership, messaging, read and typing', () => {
    it('refuses conversation:join for a non-participant with a NOT_FOUND ack', async () => {
      const client = await signUpAndSignIn(['client'], 'socket-join-client');
      const photographer = await signUpAndSignIn(['photographer'], 'socket-join-photog');
      const outsider = await signUpAndSignIn(['client'], 'socket-join-outsider');
      const conversationId = await createConversation(client.id, photographer.id);

      const socket = await connectSocket({ token: outsider.token });
      const ack = await emitWithAck<{ ok: boolean; error?: { code: string } }>(
        socket,
        'conversation:join',
        { conversationId },
      );
      expect(ack.ok).toBe(false);
      expect(ack.error?.code).toBe('NOT_FOUND');
    });

    it('delivers a REST-sent message over the socket, and a socket-sent message over REST', async () => {
      const client = await signUpAndSignIn(['client'], 'socket-roundtrip-client');
      const photographer = await signUpAndSignIn(['photographer'], 'socket-roundtrip-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      const photographerSocket = await connectSocket({ token: photographer.token });
      const joinAck = await emitWithAck<{ ok: boolean }>(photographerSocket, 'conversation:join', {
        conversationId,
      });
      expect(joinAck.ok).toBe(true);

      const messageNewPromise = new Promise<{ message: MessageBody }>((resolve) => {
        photographerSocket.once('message:new', resolve);
      });

      const restSend = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'from REST' },
      });
      expect(restSend.statusCode).toBe(201);

      const delivered = await messageNewPromise;
      expect(delivered.message.body).toBe('from REST');

      const clientSocket = await connectSocket({ token: client.token });
      const sendAck = await emitWithAck<{ ok: boolean; data?: { message: MessageBody } }>(
        clientSocket,
        'message:send',
        { conversationId, body: 'from socket' },
      );
      expect(sendAck.ok).toBe(true);
      expect(sendAck.data?.message.body).toBe('from socket');

      const listResponse = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(photographer.token),
      });
      const bodies = listResponse.json<PaginatedBody<MessageBody>>().items.map((m) => m.body);
      expect(bodies).toContain('from socket');
    });

    it('marks a conversation as read over the socket', async () => {
      const client = await signUpAndSignIn(['client'], 'socket-read-client');
      const photographer = await signUpAndSignIn(['photographer'], 'socket-read-photog');
      const conversationId = await createConversation(client.id, photographer.id);
      const send = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'read me' },
      });
      const message = send.json<MessageBody>();

      const socket = await connectSocket({ token: photographer.token });
      const ack = await emitWithAck<{ ok: boolean; data?: { conversation: ConversationBody } }>(
        socket,
        'read',
        { conversationId, upToMessageId: message.id },
      );
      expect(ack.ok).toBe(true);
      expect(ack.data?.conversation.unreadCount).toBe(0);
    });

    it('throttles typing relays to at most one per 2 seconds per socket', async () => {
      const client = await signUpAndSignIn(['client'], 'socket-typing-client');
      const photographer = await signUpAndSignIn(['photographer'], 'socket-typing-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      const clientSocket = await connectSocket({ token: client.token });
      const photographerSocket = await connectSocket({ token: photographer.token });
      await emitWithAck(photographerSocket, 'conversation:join', { conversationId });

      const received: unknown[] = [];
      photographerSocket.on('typing', (event: unknown) => received.push(event));

      const firstRelayed = new Promise<void>((resolve) => {
        photographerSocket.once('typing', () => {
          resolve();
        });
      });
      clientSocket.emit('typing', { conversationId, isTyping: true });
      await firstRelayed;

      // Anchored to the moment the first relay lands, not to a fixed
      // wall-clock offset from test start: robust even when the process is
      // under load from another suite running concurrently (issue #50).
      clientSocket.emit('typing', { conversationId, isTyping: true });
      clientSocket.emit('typing', { conversationId, isTyping: true });

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(received).toHaveLength(1);
    });
  });

  describe('offline push notifications', () => {
    it('notifies an offline recipient once, collapsing a second message within the window', async () => {
      const client = await signUpAndSignIn(['client'], 'push-offline-client');
      const photographer = await signUpAndSignIn(['photographer'], 'push-offline-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'are you there?' },
      });
      await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'hello?' },
      });

      // sendMessage's notify call is fire-and-forget, so the row can land
      // slightly after the HTTP response returns.
      await waitFor(async () => {
        const count = await prisma.notification.count({
          where: { userId: photographer.id, type: 'message_received' },
        });
        return count > 0;
      });
      const notifications = await prisma.notification.findMany({
        where: { userId: photographer.id, type: 'message_received' },
      });
      expect(notifications).toHaveLength(1);
      expect((notifications[0]?.payload as { conversationId?: string }).conversationId).toBe(
        conversationId,
      );
    });

    it('does not notify a recipient with a connected socket', async () => {
      const client = await signUpAndSignIn(['client'], 'push-online-client');
      const photographer = await signUpAndSignIn(['photographer'], 'push-online-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      await connectSocket({ token: photographer.token });

      await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'i see you' },
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      const notifications = await prisma.notification.findMany({
        where: { userId: photographer.id, type: 'message_received' },
      });
      expect(notifications).toHaveLength(0);
    });
  });

  describe('connection cap and event validation', () => {
    it('refuses an 11th socket for the same user', async () => {
      const user = await signUpAndSignIn(['client'], 'connection-cap');
      for (let i = 0; i < 10; i += 1) {
        const socket = await connectSocket({ token: user.token });
        expect(socket.connected).toBe(true);
      }
      await expect(connectSocket({ token: user.token })).rejects.toBeTruthy();
    });

    it('gives an invalid payload a BAD_REQUEST ack without disconnecting the socket', async () => {
      const user = await signUpAndSignIn(['client'], 'invalid-payload');
      const socket = await connectSocket({ token: user.token });

      const ack = await emitWithAck<{ ok: boolean; error?: { code: string } }>(
        socket,
        'message:send',
        { conversationId: 'not-a-uuid' },
      );
      expect(ack.ok).toBe(false);
      expect(ack.error?.code).toBe('BAD_REQUEST');
      expect(socket.connected).toBe(true);

      const followUp = await emitWithAck<{ ok: boolean }>(socket, 'conversation:join', {
        conversationId: randomUUID(),
      });
      expect(followUp.ok).toBe(false);
    });

    it('gives a socket-sent message a TOO_MANY_REQUESTS ack once the per-minute limit is hit', async () => {
      const client = await signUpAndSignIn(['client'], 'socket-rate-client');
      const photographer = await signUpAndSignIn(['photographer'], 'socket-rate-photog');
      const conversationId = await createConversation(client.id, photographer.id);
      const socket = await connectSocket({ token: client.token });

      for (let i = 0; i < 30; i += 1) {
        const ack = await emitWithAck<{ ok: boolean }>(socket, 'message:send', {
          conversationId,
          body: `socket message ${String(i)}`,
        });
        expect(ack.ok).toBe(true);
        // Paced under the per-socket 20-events/s limit (S1), so this test
        // only ever exercises the chat-message-specific 30/minute limit.
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      const overflow = await emitWithAck<{ ok: boolean; error?: { code: string } }>(
        socket,
        'message:send',
        { conversationId, body: 'one too many' },
      );
      expect(overflow.ok).toBe(false);
      expect(overflow.error?.code).toBe('TOO_MANY_REQUESTS');
      expect(socket.connected).toBe(true);
    });
  });

  describe('deleting a message from a different conversation', () => {
    it('returns 404 rather than leaking the message into the wrong conversation', async () => {
      const client = await signUpAndSignIn(['client'], 'cross-conv-client');
      const photographer = await signUpAndSignIn(['photographer'], 'cross-conv-photog');
      const otherPhotographer = await signUpAndSignIn(['photographer'], 'cross-conv-other');
      const conversationId = await createConversation(client.id, photographer.id);
      const otherConversationId = await createConversation(client.id, otherPhotographer.id);

      const send = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'in the first conversation' },
      });
      const message = send.json<MessageBody>();

      const response = await fastify().inject({
        method: 'DELETE',
        url: `/v1/conversations/${otherConversationId}/messages/${message.id}`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('realtime events for read, archive and delete', () => {
    it('emits conversation:updated to the reader on read', async () => {
      const client = await signUpAndSignIn(['client'], 'realtime-read-client');
      const photographer = await signUpAndSignIn(['photographer'], 'realtime-read-photog');
      const conversationId = await createConversation(client.id, photographer.id);
      const send = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'read me over the socket' },
      });
      const message = send.json<MessageBody>();

      const photographerSocket = await connectSocket({ token: photographer.token });
      const updated = new Promise<{ conversation: ConversationBody }>((resolve) => {
        photographerSocket.once('conversation:updated', resolve);
      });

      await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/read`,
        headers: authHeaders(photographer.token),
        payload: { upToMessageId: message.id },
      });

      const event = await updated;
      expect(event.conversation.unreadCount).toBe(0);
    });

    it('emits conversation:updated to the archiver on archive', async () => {
      const client = await signUpAndSignIn(['client'], 'realtime-archive-client');
      const photographer = await signUpAndSignIn(['photographer'], 'realtime-archive-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      const photographerSocket = await connectSocket({ token: photographer.token });
      const updated = new Promise<{ conversation: ConversationBody }>((resolve) => {
        photographerSocket.once('conversation:updated', resolve);
      });

      await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/archive`,
        headers: authHeaders(photographer.token),
      });

      const event = await updated;
      expect(event.conversation.archivedByMe).toBe(true);
    });

    it('emits message:deleted to participants when the sender deletes a message', async () => {
      const client = await signUpAndSignIn(['client'], 'realtime-delete-client');
      const photographer = await signUpAndSignIn(['photographer'], 'realtime-delete-photog');
      const conversationId = await createConversation(client.id, photographer.id);
      const send = await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'delete me over the socket' },
      });
      const message = send.json<MessageBody>();

      const photographerSocket = await connectSocket({ token: photographer.token });
      const deleted = new Promise<{ message: MessageBody }>((resolve) => {
        photographerSocket.once('message:deleted', resolve);
      });

      await fastify().inject({
        method: 'DELETE',
        url: `/v1/conversations/${conversationId}/messages/${message.id}`,
        headers: authHeaders(client.token),
      });

      const event = await deleted;
      expect(event.message.body).toBeNull();
      expect(event.message.deletedAt).not.toBeNull();
    });
  });

  describe('session lifecycle (M1)', () => {
    it('disconnects the chat socket on sign-out', async () => {
      const email = uniqueEmail('m1-sign-out');
      const signUpResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-up',
        remoteAddress: AUTH_FAKE_IP,
        payload: { email, password: PASSWORD, roles: ['client'], locale: 'en' },
      });
      const userId = signUpResponse.json<{ user: { id: string } }>().user.id;
      createdUserIds.push(userId);
      const link = await waitForLinkInEmail(email, /https?:\/\/\S*verify-email#token=\S+/);
      const token = extractFragmentToken(link);
      if (!token) throw new Error(`no token found in verification link: ${link}`);
      await fastify().inject({
        method: 'POST',
        url: '/v1/auth/verify-email',
        remoteAddress: AUTH_FAKE_IP,
        payload: { token },
      });
      const signInResponse = await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-in',
        remoteAddress: AUTH_FAKE_IP,
        payload: { email, password: PASSWORD },
      });
      const signedIn = signInResponse.json<{ session: { token: string } }>();

      const socket = await connectSocket({ token: signedIn.session.token });
      const disconnected = new Promise<void>((resolve) => {
        socket.once('disconnect', () => {
          resolve();
        });
      });

      await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sign-out',
        headers: authHeaders(signedIn.session.token),
      });

      await disconnected;
      expect(socket.connected).toBe(false);
    });

    it('disconnects every chat socket for the user on revoke-all', async () => {
      const user = await signUpAndSignIn(['client'], 'm1-revoke-all');
      const socketA = await connectSocket({ token: user.token });
      const socketB = await connectSocket({ token: user.token });
      const disconnectedA = new Promise<void>((resolve) => {
        socketA.once('disconnect', () => {
          resolve();
        });
      });
      const disconnectedB = new Promise<void>((resolve) => {
        socketB.once('disconnect', () => {
          resolve();
        });
      });

      await fastify().inject({
        method: 'POST',
        url: '/v1/auth/sessions/revoke-all',
        headers: authHeaders(user.token),
      });

      await Promise.all([disconnectedA, disconnectedB]);
      expect(socketA.connected).toBe(false);
      expect(socketB.connected).toBe(false);
    });

    it('disconnects the chat socket on a password reset', async () => {
      const user = await signUpAndSignIn(['client'], 'm1-password-reset');
      const socket = await connectSocket({ token: user.token });
      const disconnected = new Promise<void>((resolve) => {
        socket.once('disconnect', () => {
          resolve();
        });
      });

      await fastify().inject({
        method: 'POST',
        url: '/v1/auth/password-reset/request',
        remoteAddress: AUTH_FAKE_IP,
        payload: { email: user.email },
      });
      const link = await waitForLinkInEmail(user.email, /https?:\/\/\S*reset-password#token=\S+/);
      const resetToken = extractFragmentToken(link);
      if (!resetToken) throw new Error(`no token found in reset link: ${link}`);

      await fastify().inject({
        method: 'POST',
        url: '/v1/auth/password-reset/confirm',
        remoteAddress: AUTH_FAKE_IP,
        payload: { token: resetToken, password: `photoo-test-new-${randomUUID()}` },
      });

      await disconnected;
      expect(socket.connected).toBe(false);
    });
  });

  describe('pagination', () => {
    it('paginates conversations across 3+ pages, non-null lastMessageAt desc before null, each with an id tiebreak', async () => {
      // 1 client + 3 photographers stays under the 5/hour sign-up limit per
      // IP that this whole file already shares (issue #50); limit=1 still
      // forces exactly 3 pages for 3 conversations.
      const client = await signUpAndSignIn(['client'], 'paginate-conv-client');
      const photographers = [];
      for (let i = 0; i < 3; i += 1) {
        photographers.push(
          await signUpAndSignIn(['photographer'], `paginate-conv-photog-${String(i)}`),
        );
      }
      const conversationIds: string[] = [];
      for (const photographer of photographers) {
        conversationIds.push(await createConversation(client.id, photographer.id));
      }
      for (let i = 0; i < 2; i += 1) {
        const conversationId = conversationIds[i];
        if (!conversationId) throw new Error('expected a fixture conversation id');
        await fastify().inject({
          method: 'POST',
          url: `/v1/conversations/${conversationId}/messages`,
          headers: authHeaders(client.token),
          payload: { body: `msg ${String(i)}` },
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      const { items, pages } = await fetchAllPages<ConversationBody>(async (cursor) => {
        const url = `/v1/conversations?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const response = await fastify().inject({
          method: 'GET',
          url,
          headers: authHeaders(client.token),
        });
        return response.json<PaginatedBody<ConversationBody>>();
      });
      const seen = items.map((c) => c.id);

      expect(pages).toBe(3);
      expect(seen).toEqual([conversationIds[1], conversationIds[0], conversationIds[2]]);
    });

    it('paginates messages without gaps or duplicates when createdAt ties', async () => {
      const client = await signUpAndSignIn(['client'], 'paginate-msg-client');
      const photographer = await signUpAndSignIn(['photographer'], 'paginate-msg-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      const tiedAt = new Date();
      const messages = [];
      for (let i = 0; i < 5; i += 1) {
        messages.push(
          await prisma.message.create({
            data: { conversationId, senderId: client.id, body: `tied ${String(i)}` },
          }),
        );
      }
      await prisma.message.updateMany({
        where: { id: { in: messages.map((m) => m.id) } },
        data: { createdAt: tiedAt },
      });

      const { items, pages } = await fetchAllPages<MessageBody>(async (cursor) => {
        const url = `/v1/conversations/${conversationId}/messages?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const response = await fastify().inject({
          method: 'GET',
          url,
          headers: authHeaders(photographer.token),
        });
        return response.json<PaginatedBody<MessageBody>>();
      });
      const seen = items.map((m) => m.id);

      expect(pages).toBeGreaterThanOrEqual(3);
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort()).toEqual(messages.map((m) => m.id).sort());
    });
  });

  describe('participant identity', () => {
    it('exposes no email or role in a participant summary', async () => {
      const client = await signUpAndSignIn(['client'], 'identity-client');
      const photographer = await signUpAndSignIn(['photographer'], 'identity-photog');
      const conversationId = await createConversation(client.id, photographer.id);

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(200);
      const conversation = response.json<ConversationBody>();
      expect(conversation.participants.length).toBeGreaterThan(0);
      for (const participant of conversation.participants) {
        expect(Object.keys(participant.user).sort()).toEqual(['avatarUrl', 'displayName', 'id']);
      }
    });

    it('uses the photographer profile displayName and avatar for a photographer participant', async () => {
      const client = await signUpAndSignIn(['client'], 'identity-profile-client');
      const photographer = await signUpAndSignIn(['photographer'], 'identity-profile-photog');
      const suffix = `identity-${photographer.id.slice(0, 8)}`;
      await createPhotographerProfileDirect(photographer.id, suffix);
      const conversationId = await createConversation(client.id, photographer.id);

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}`,
        headers: authHeaders(client.token),
      });
      const conversation = response.json<ConversationBody>();
      const participant = conversation.participants.find((p) => p.userId === photographer.id);
      expect(participant?.user.displayName).toBe(`Fx Chat Photog ${suffix}`);
    });

    it('never leaks a client email through their participant displayName', async () => {
      const client = await signUpAndSignIn(['client'], 'identity-no-leak-client');
      const photographer = await signUpAndSignIn(['photographer'], 'identity-no-leak-photog');
      const conversationId = await createConversation(client.id, photographer.id);
      await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(client.token),
        payload: { body: 'Hi, looking forward to it' },
      });
      const emailLocalPart = client.email.split('@')[0];
      if (!emailLocalPart) throw new Error('expected a fixture email with a local part');

      const conversationResponse = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}`,
        headers: authHeaders(photographer.token),
      });
      expect(conversationResponse.statusCode).toBe(200);
      const conversation = conversationResponse.json<ConversationBody>();
      const clientParticipant = conversation.participants.find((p) => p.userId === client.id);
      expect(clientParticipant?.user.displayName).toBeNull();
      expect(conversationResponse.body).not.toContain(emailLocalPart);

      const messagesResponse = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: authHeaders(photographer.token),
      });
      expect(messagesResponse.statusCode).toBe(200);
      expect(messagesResponse.body).not.toContain(emailLocalPart);
    });
  });

  describe('conversation subjectRef', () => {
    it('includes the request title for a quote made on a request', async () => {
      const client = await signUpAndSignIn(['client'], 'subjectref-req-client');
      const photographer = await signUpAndSignIn(['photographer'], 'subjectref-req-photog');
      const profileId = await createPhotographerProfileDirect(
        photographer.id,
        `subjectref-req-${photographer.id.slice(0, 8)}`,
      );
      const request = await createRequestFixture(client.id, `subjectref-${client.id.slice(0, 8)}`);
      const quoteId = await createQuoteFixture({
        photographerId: profileId,
        clientId: client.id,
        requestId: request.id,
      });
      const conversationId = await createQuoteConversationFixture(
        quoteId,
        client.id,
        photographer.id,
      );

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}`,
        headers: authHeaders(client.token),
      });
      expect(response.statusCode).toBe(200);
      const conversation = response.json<ConversationBody>();
      expect(conversation.subjectRef).toEqual({
        type: 'quote',
        quoteId,
        requestTitle: request.title,
      });
    });

    it('omits requestTitle for a direct quote with no request', async () => {
      const client = await signUpAndSignIn(['client'], 'subjectref-direct-client');
      const photographer = await signUpAndSignIn(['photographer'], 'subjectref-direct-photog');
      const suffix = `subjectref-direct-${photographer.id.slice(0, 8)}`;
      const profileId = await createPhotographerProfileDirect(photographer.id, suffix);
      const productId = await createProductFixture(profileId, suffix);
      const quoteId = await createQuoteFixture({
        photographerId: profileId,
        clientId: client.id,
        requestId: null,
        productId,
      });
      const conversationId = await createQuoteConversationFixture(
        quoteId,
        client.id,
        photographer.id,
      );

      const response = await fastify().inject({
        method: 'GET',
        url: `/v1/conversations/${conversationId}`,
        headers: authHeaders(photographer.token),
      });
      expect(response.statusCode).toBe(200);
      const conversation = response.json<ConversationBody>();
      expect(conversation.subjectRef).toEqual({ type: 'quote', quoteId });
    });
  });

  describe('GET /v1/conversations/unread-count', () => {
    it('requires a session', async () => {
      const response = await fastify().inject({
        method: 'GET',
        url: '/v1/conversations/unread-count',
      });
      expect(response.statusCode).toBe(401);
    });

    it('matches the sum of unreadCount across the paged conversation list', async () => {
      const client = await signUpAndSignIn(['client'], 'unread-total-client');
      const photographerA = await signUpAndSignIn(['photographer'], 'unread-total-photog-a');
      const photographerB = await signUpAndSignIn(['photographer'], 'unread-total-photog-b');
      const conversationA = await createConversation(client.id, photographerA.id);
      const conversationB = await createConversation(client.id, photographerB.id);

      for (const body of ['From A: one', 'From A: two']) {
        await fastify().inject({
          method: 'POST',
          url: `/v1/conversations/${conversationA}/messages`,
          headers: authHeaders(photographerA.token),
          payload: { body },
        });
      }
      await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationB}/messages`,
        headers: authHeaders(photographerB.token),
        payload: { body: 'From B: one' },
      });

      const { items } = await fetchAllPages<ConversationBody>(async (cursor) => {
        const url = `/v1/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
        const response = await fastify().inject({
          method: 'GET',
          url,
          headers: authHeaders(client.token),
        });
        return response.json<PaginatedBody<ConversationBody>>();
      });
      const expectedTotal = items.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
      expect(expectedTotal).toBe(3);

      const unreadResponse = await fastify().inject({
        method: 'GET',
        url: '/v1/conversations/unread-count',
        headers: authHeaders(client.token),
      });
      expect(unreadResponse.statusCode).toBe(200);
      expect(unreadResponse.json<UnreadCountBody>().count).toBe(expectedTotal);
    });

    it('is isolated per user', async () => {
      const clientA = await signUpAndSignIn(['client'], 'unread-iso-client-a');
      const clientB = await signUpAndSignIn(['client'], 'unread-iso-client-b');
      const photographer = await signUpAndSignIn(['photographer'], 'unread-iso-photog');
      const conversationA = await createConversation(clientA.id, photographer.id);
      await createConversation(clientB.id, photographer.id);

      await fastify().inject({
        method: 'POST',
        url: `/v1/conversations/${conversationA}/messages`,
        headers: authHeaders(photographer.token),
        payload: { body: 'Hi A' },
      });

      const countA = await fastify().inject({
        method: 'GET',
        url: '/v1/conversations/unread-count',
        headers: authHeaders(clientA.token),
      });
      const countB = await fastify().inject({
        method: 'GET',
        url: '/v1/conversations/unread-count',
        headers: authHeaders(clientB.token),
      });
      expect(countA.json<UnreadCountBody>().count).toBe(1);
      expect(countB.json<UnreadCountBody>().count).toBe(0);
    });
  });
});

// A separate app instance with an overridden CHAT_CLOCK, so the throttle
// boundary (item 11) can be tested at exact millisecond offsets instead of
// real wall-clock timing.
describe('typing throttle with an injected clock', () => {
  if (!testEnv) {
    it.skip('skipped: TEST_DATABASE_URL or REDIS_URL is not set', () => undefined);
    return;
  }

  let app: NestFastifyApplication;
  let baseUrl: string;
  let prisma: PrismaClient;
  let redis: Redis;
  let clockValueMs = 0;
  const createdUserIds: string[] = [];
  const createdConversationIds: string[] = [];
  const sockets: ClientSocket[] = [];
  const CLOCK_AUTH_FAKE_IP = '10.50.7.3';

  function fastify() {
    return app.getHttpAdapter().getInstance();
  }

  // Sign-up is capped at 5 per hour per IP; without clearing it here, two
  // sign-ups per run of this describe accumulate across every previous
  // invocation and eventually lock CLOCK_AUTH_FAKE_IP out, making
  // signUpAndSignIn() throw on an undefined session/user body.
  async function clearRateLimitKeys(): Promise<void> {
    const patterns = [
      `rate-limit:auth:*:${CLOCK_AUTH_FAKE_IP}`,
      `lockout:auth:*:${CLOCK_AUTH_FAKE_IP}`,
    ];
    const globbed = (await Promise.all(patterns.map((pattern) => redis.keys(pattern)))).flat();
    if (globbed.length > 0) {
      await redis.del(...globbed);
    }
  }

  async function signUpAndSignIn(): Promise<{ token: string; id: string }> {
    const email = uniqueEmail('clock');
    const signUpResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-up',
      remoteAddress: CLOCK_AUTH_FAKE_IP,
      payload: { email, password: PASSWORD, roles: ['client'], locale: 'en' },
    });
    const userId = signUpResponse.json<{ user: { id: string } }>().user.id;
    createdUserIds.push(userId);
    const link = await waitForLinkInEmail(email, /https?:\/\/\S*verify-email#token=\S+/);
    const token = extractFragmentToken(link);
    if (!token) throw new Error(`no token found in verification link: ${link}`);
    await fastify().inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      remoteAddress: CLOCK_AUTH_FAKE_IP,
      payload: { token },
    });
    const signInResponse = await fastify().inject({
      method: 'POST',
      url: '/v1/auth/sign-in',
      remoteAddress: CLOCK_AUTH_FAKE_IP,
      payload: { email, password: PASSWORD },
    });
    return {
      token: signInResponse.json<{ session: { token: string } }>().session.token,
      id: userId,
    };
  }

  function connectSocket(token: string): Promise<ClientSocket> {
    const socket = io(baseUrl, {
      path: '/v1/socket.io',
      transports: ['polling'],
      forceNew: true,
      reconnection: false,
      auth: { token },
    });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => {
        resolve(socket);
      });
      socket.once('connect_error', (error: Error) => {
        reject(error);
      });
    });
  }

  beforeAll(async () => {
    const env: Env = {
      ...TEST_ENV,
      DATABASE_URL: testEnv.TEST_DATABASE_URL,
      REDIS_URL: testEnv.REDIS_URL,
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, TestEmailWorkerModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(env)
      .overrideProvider(CHAT_CLOCK)
      .useValue(() => clockValueMs)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(env.TRUSTED_PROXIES),
    );
    await configureApp(app, env);
    const redisIoAdapter = new RedisIoAdapter(app, env.REDIS_URL);
    redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${String(port)}`;
    prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);
    redis = new Redis(testEnv.REDIS_URL);
    await clearRateLimitKeys();
  });

  afterAll(async () => {
    await clearRateLimitKeys();
    redis.disconnect();
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
    if (createdConversationIds.length > 0) {
      await prisma.conversation.deleteMany({ where: { id: { in: createdConversationIds } } });
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('throttles one millisecond before the window, and relays again exactly at the window', async () => {
    const client = await signUpAndSignIn();
    const photographer = await signUpAndSignIn();
    const conversation = await prisma.conversation.create({
      data: {
        type: 'quote',
        subjectId: randomUUID(),
        participants: { create: [{ userId: client.id }, { userId: photographer.id }] },
      },
    });
    createdConversationIds.push(conversation.id);
    const socket = await connectSocket(client.token);
    const photographerSocket = await connectSocket(photographer.token);
    const conversationId = conversation.id;
    await new Promise<void>((resolve) => {
      photographerSocket.emit('conversation:join', { conversationId }, () => {
        resolve();
      });
    });

    let relayedCount = 0;
    photographerSocket.on('typing', () => {
      relayedCount += 1;
    });

    async function emitTyping(): Promise<void> {
      await new Promise<void>((resolve) => {
        socket.emit('typing', { conversationId, isTyping: true }, () => {
          resolve();
        });
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    clockValueMs = 1_000_000;
    await emitTyping();
    expect(relayedCount).toBe(1);

    clockValueMs += 1999;
    await emitTyping();
    expect(relayedCount).toBe(1);

    clockValueMs += 1;
    await emitTyping();
    expect(relayedCount).toBe(2);
  });
});
