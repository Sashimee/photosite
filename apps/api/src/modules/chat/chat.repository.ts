import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ConversationCursor } from './conversation-cursor.js';

export interface ConversationListRow {
  id: string;
  type: string;
  subjectId: string | null;
  lastMessageAt: Date | null;
  myLastReadAt: Date | null;
  myArchivedAt: Date | null;
  lastMessageBody: string | null;
  lastMessageDeletedAt: Date | null;
  unreadCount: number;
}

const CONVERSATION_ROW_SELECT = Prisma.sql`
  c.id AS "id",
  c."type"::text AS "type",
  c."subjectId" AS "subjectId",
  c."lastMessageAt" AS "lastMessageAt",
  p."lastReadAt" AS "myLastReadAt",
  p."archivedAt" AS "myArchivedAt",
  lm.body AS "lastMessageBody",
  lm."deletedAt" AS "lastMessageDeletedAt",
  COALESCE(uc.count, 0)::int AS "unreadCount"
`;

// One JOIN plus two LATERAL subqueries per conversation, instead of a
// separate last-message query and a separate count query per row in the
// page (the N+1 flagged in the 1A.6b review): each lateral still uses the
// (conversationId, createdAt desc, id) index the way the split queries did.
function conversationJoins(userId: string): Prisma.Sql {
  return Prisma.sql`
    FROM "Conversation" c
    JOIN "ConversationParticipant" p ON p."conversationId" = c.id AND p."userId" = ${userId}
    LEFT JOIN LATERAL (
      SELECT m.body, m."deletedAt"
      FROM "Message" m
      WHERE m."conversationId" = c.id
      ORDER BY m."createdAt" DESC, m.id DESC
      LIMIT 1
    ) lm ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS count
      FROM "Message" m2
      WHERE m2."conversationId" = c.id
        AND m2."senderId" != ${userId}
        AND m2."deletedAt" IS NULL
        AND (p."lastReadAt" IS NULL OR m2."createdAt" > p."lastReadAt")
    ) uc ON true
  `;
}

function cursorSql(cursor: ConversationCursor): Prisma.Sql {
  if (cursor.lastMessageAt === null) {
    return Prisma.sql`c."lastMessageAt" IS NULL AND c.id > ${cursor.id}`;
  }
  const at = new Date(cursor.lastMessageAt);
  return Prisma.sql`(
    c."lastMessageAt" < ${at}
    OR (c."lastMessageAt" = ${at} AND c.id > ${cursor.id})
    OR c."lastMessageAt" IS NULL
  )`;
}

@Injectable()
export class ChatRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationListRow | null> {
    const rows = await this.prisma.client.$queryRaw<ConversationListRow[]>`
      SELECT ${CONVERSATION_ROW_SELECT}
      ${conversationJoins(userId)}
      WHERE c.id = ${conversationId}
    `;
    return rows[0] ?? null;
  }

  async listConversations(
    userId: string,
    archived: boolean,
    limit: number,
    cursor?: ConversationCursor,
  ): Promise<ConversationListRow[]> {
    const archivedCondition = archived
      ? Prisma.sql`p."archivedAt" IS NOT NULL`
      : Prisma.sql`p."archivedAt" IS NULL`;
    const cursorCondition = cursor ? cursorSql(cursor) : Prisma.sql`TRUE`;

    return this.prisma.client.$queryRaw<ConversationListRow[]>`
      SELECT ${CONVERSATION_ROW_SELECT}
      ${conversationJoins(userId)}
      WHERE ${archivedCondition} AND ${cursorCondition}
      ORDER BY c."lastMessageAt" DESC NULLS LAST, c.id ASC
      LIMIT ${limit}
    `;
  }
}
