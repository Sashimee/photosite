import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './index.js';
import {
  SEED_REQUEST_CLIENT_EMAIL,
  SEED_REQUEST_PHOTOGRAPHER_SLUG,
  seedDatabase,
  seedQuoteConversation,
} from './seed.js';
import { requireIntegrationEnv } from './testing/require-integration-env.js';

const testEnv = requireIntegrationEnv(['TEST_DATABASE_URL']);

const FIXTURE_CLIENT_EMAIL = 'test-fixture.chat-client@photoo.test';
const FIXTURE_PHOTOGRAPHER_EMAIL = 'test-fixture.chat-photographer@photoo.test';

describe('chat schema', () => {
  if (!testEnv) {
    it.skip(
      'enforces conversation/participant/attachment uniqueness and cascade rules (skipped: TEST_DATABASE_URL is not set)',
    );
    return;
  }

  const prisma = createPrismaClient(testEnv.TEST_DATABASE_URL);

  let clientId: string;
  let photographerUserId: string;

  async function deleteFixtures(): Promise<void> {
    await prisma.user.deleteMany({
      where: { email: { in: [FIXTURE_CLIENT_EMAIL, FIXTURE_PHOTOGRAPHER_EMAIL] } },
    });
  }

  beforeAll(async () => {
    await seedDatabase(prisma);
    await deleteFixtures();

    const client = await prisma.user.create({
      data: {
        email: FIXTURE_CLIENT_EMAIL,
        emailVerifiedAt: new Date(),
        name: 'Chat Fixture Client',
        locale: 'en',
        countryCode: 'LU',
        roles: ['client'],
        status: 'active',
      },
    });
    clientId = client.id;

    const photographerUser = await prisma.user.create({
      data: {
        email: FIXTURE_PHOTOGRAPHER_EMAIL,
        emailVerifiedAt: new Date(),
        name: 'Chat Fixture Photographer',
        locale: 'en',
        countryCode: 'LU',
        roles: ['photographer'],
        status: 'active',
      },
    });
    photographerUserId = photographerUser.id;
  });

  afterAll(async () => {
    await deleteFixtures();
    await prisma.$disconnect();
  });

  describe('Conversation unique (type, subjectId)', () => {
    it('rejects a second quote conversation for the same subjectId', async () => {
      const subjectId = randomUUID();
      const conversation = await prisma.conversation.create({
        data: { type: 'quote', subjectId },
      });

      await expect(
        prisma.conversation.create({ data: { type: 'quote', subjectId } }),
      ).rejects.toThrow();

      await prisma.conversation.delete({ where: { id: conversation.id } });
    });

    it('allows the same subjectId for a different conversation type', async () => {
      const subjectId = randomUUID();
      const quoteConversation = await prisma.conversation.create({
        data: { type: 'quote', subjectId },
      });
      const bookingConversation = await prisma.conversation.create({
        data: { type: 'booking', subjectId },
      });

      expect(quoteConversation.id).not.toBe(bookingConversation.id);

      await prisma.conversation.deleteMany({
        where: { id: { in: [quoteConversation.id, bookingConversation.id] } },
      });
    });
  });

  describe('ConversationParticipant unique (conversationId, userId)', () => {
    it('rejects adding the same user twice to a conversation', async () => {
      const conversation = await prisma.conversation.create({
        data: { type: 'quote', subjectId: randomUUID() },
      });
      await prisma.conversationParticipant.create({
        data: { conversationId: conversation.id, userId: clientId },
      });

      await expect(
        prisma.conversationParticipant.create({
          data: { conversationId: conversation.id, userId: clientId },
        }),
      ).rejects.toThrow();

      await prisma.conversation.delete({ where: { id: conversation.id } });
    });
  });

  describe('MessageAttachment unique uploadId', () => {
    it('rejects attaching the same upload to a second message', async () => {
      const conversation = await prisma.conversation.create({
        data: {
          type: 'quote',
          subjectId: randomUUID(),
          participants: { create: [{ userId: clientId }, { userId: photographerUserId }] },
        },
      });
      const upload = await prisma.upload.create({
        data: {
          ownerId: clientId,
          purpose: 'chat_attachment',
          status: 'clean',
          mimeType: 'image/jpeg',
          declaredSizeBytes: 1024,
          objectKey: `u/${clientId}/${randomUUID()}`,
          virusScanStatus: 'clean',
        },
      });
      const firstMessage = await prisma.message.create({
        data: { conversationId: conversation.id, senderId: clientId, body: 'first message' },
      });
      const secondMessage = await prisma.message.create({
        data: { conversationId: conversation.id, senderId: clientId, body: 'second message' },
      });

      await prisma.messageAttachment.create({
        data: { messageId: firstMessage.id, uploadId: upload.id },
      });

      await expect(
        prisma.messageAttachment.create({
          data: { messageId: secondMessage.id, uploadId: upload.id },
        }),
      ).rejects.toThrow();

      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.upload.delete({ where: { id: upload.id } });
    });
  });

  describe('cascade rules', () => {
    it('deleting a conversation removes its participants and messages', async () => {
      const conversation = await prisma.conversation.create({
        data: {
          type: 'quote',
          subjectId: randomUUID(),
          participants: { create: [{ userId: clientId }, { userId: photographerUserId }] },
        },
      });
      const message = await prisma.message.create({
        data: { conversationId: conversation.id, senderId: clientId, body: 'hello' },
      });

      await prisma.conversation.delete({ where: { id: conversation.id } });

      const remainingParticipants = await prisma.conversationParticipant.count({
        where: { conversationId: conversation.id },
      });
      const remainingMessages = await prisma.message.count({
        where: { id: message.id },
      });
      expect(remainingParticipants).toBe(0);
      expect(remainingMessages).toBe(0);
    });

    it('deleting a message removes its attachments but leaves the upload in place', async () => {
      const conversation = await prisma.conversation.create({
        data: {
          type: 'quote',
          subjectId: randomUUID(),
          participants: { create: [{ userId: clientId }, { userId: photographerUserId }] },
        },
      });
      const upload = await prisma.upload.create({
        data: {
          ownerId: clientId,
          purpose: 'chat_attachment',
          status: 'clean',
          mimeType: 'image/jpeg',
          declaredSizeBytes: 1024,
          objectKey: `u/${clientId}/${randomUUID()}`,
          virusScanStatus: 'clean',
        },
      });
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: clientId,
          attachments: { create: [{ uploadId: upload.id }] },
        },
      });

      await prisma.message.delete({ where: { id: message.id } });

      const remainingAttachments = await prisma.messageAttachment.count({
        where: { uploadId: upload.id },
      });
      expect(remainingAttachments).toBe(0);

      const stillExistingUpload = await prisma.upload.findUnique({ where: { id: upload.id } });
      expect(stillExistingUpload).not.toBeNull();

      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.upload.delete({ where: { id: upload.id } });
    });

    it('rejects deleting an upload that is still attached to a message', async () => {
      const conversation = await prisma.conversation.create({
        data: {
          type: 'quote',
          subjectId: randomUUID(),
          participants: { create: [{ userId: clientId }, { userId: photographerUserId }] },
        },
      });
      const upload = await prisma.upload.create({
        data: {
          ownerId: clientId,
          purpose: 'chat_attachment',
          status: 'clean',
          mimeType: 'image/jpeg',
          declaredSizeBytes: 1024,
          objectKey: `u/${clientId}/${randomUUID()}`,
          virusScanStatus: 'clean',
        },
      });
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderId: clientId,
          attachments: { create: [{ uploadId: upload.id }] },
        },
      });

      await expect(prisma.upload.delete({ where: { id: upload.id } })).rejects.toThrow();

      await prisma.conversation.delete({ where: { id: conversation.id } });
      await prisma.upload.delete({ where: { id: upload.id } });
    });
  });

  describe('seedQuoteConversation', () => {
    it('creates one quote conversation with two messages, and is idempotent on a second run', async () => {
      const seedClient = await prisma.user.findUniqueOrThrow({
        where: { email: SEED_REQUEST_CLIENT_EMAIL },
      });
      const seedPhotographer = await prisma.photographerProfile.findUniqueOrThrow({
        where: { slug: SEED_REQUEST_PHOTOGRAPHER_SLUG },
      });
      const seedQuote = await prisma.quote.findFirstOrThrow({
        where: { clientId: seedClient.id, photographerId: seedPhotographer.id },
      });

      await seedQuoteConversation(prisma);

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: { type_subjectId: { type: 'quote', subjectId: seedQuote.id } },
        include: { participants: true, messages: true },
      });

      expect(conversation.participants.map((p) => p.userId).sort()).toEqual(
        [seedClient.id, seedPhotographer.userId].sort(),
      );
      expect(conversation.messages).toHaveLength(2);
      expect(conversation.lastMessageAt).not.toBeNull();

      await seedQuoteConversation(prisma);

      const countAfterSecondRun = await prisma.conversation.count({
        where: { type: 'quote', subjectId: seedQuote.id },
      });
      expect(countAfterSecondRun).toBe(1);
      const messageCountAfterSecondRun = await prisma.message.count({
        where: { conversationId: conversation.id },
      });
      expect(messageCountAfterSecondRun).toBe(2);
    });
  });

  describe('seedDatabase for chat', () => {
    it('is idempotent: running the seed again does not duplicate the seeded conversation', async () => {
      const seedClient = await prisma.user.findUniqueOrThrow({
        where: { email: SEED_REQUEST_CLIENT_EMAIL },
      });
      const seedPhotographer = await prisma.photographerProfile.findUniqueOrThrow({
        where: { slug: SEED_REQUEST_PHOTOGRAPHER_SLUG },
      });
      const seedQuote = await prisma.quote.findFirstOrThrow({
        where: { clientId: seedClient.id, photographerId: seedPhotographer.id },
      });

      await seedDatabase(prisma);
      const before = await prisma.conversation.count({
        where: { type: 'quote', subjectId: seedQuote.id },
      });

      await seedDatabase(prisma);
      const after = await prisma.conversation.count({
        where: { type: 'quote', subjectId: seedQuote.id },
      });

      expect(before).toBe(1);
      expect(after).toBe(1);
    });
  });
});
