import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@photoo/db';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ConversationCursor } from './conversation-cursor.js';

export interface ConversationListRow {
  id: string;
  type: string;
  subjectId: string | null;
  subjectRequestTitle: string | null;
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
  sr."requestTitle" AS "subjectRequestTitle",
  c."lastMessageAt" AS "lastMessageAt",
  p."lastReadAt" AS "myLastReadAt",
  p."archivedAt" AS "myArchivedAt",
  lm.body AS "lastMessageBody",
  lm."deletedAt" AS "lastMessageDeletedAt",
  COALESCE(uc.count, 0)::int AS "unreadCount"
`;

// One JOIN plus three LATERAL subqueries per conversation, instead of a
// separate last-message query, a separate count query and a separate
// quote/request lookup per row in the page (the N+1 flagged in the 1A.6b
// review): each lateral still uses the (conversationId, createdAt desc, id)
// index the way the split queries did. The subjectRef lateral only matches
// `quote` conversations (the only creatable type in the MVP); it stays a
// no-op join for any other type.
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
    LEFT JOIN LATERAL (
      SELECT r.title AS "requestTitle"
      FROM "Quote" q
      LEFT JOIN "Request" r ON r.id = q."requestId"
      WHERE c."type" = 'quote' AND q.id = c."subjectId"
    ) sr ON true
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

  // GROUP BY conversation then SUM, so this stays one query regardless of
  // how many conversations the user has (docs/steps/1B.6-chat-ui.md "the
  // unread count is one grouped query").
  async countUnreadMessages(userId: string): Promise<number> {
    const rows = await this.prisma.client.$queryRaw<{ count: number }[]>`
      SELECT COALESCE(SUM(sub.unread), 0)::int AS count
      FROM (
        SELECT COUNT(m.id)::int AS unread
        FROM "ConversationParticipant" p
        JOIN "Message" m ON m."conversationId" = p."conversationId"
        WHERE p."userId" = ${userId}
          AND p."archivedAt" IS NULL
          AND m."senderId" != ${userId}
          AND m."deletedAt" IS NULL
          AND (p."lastReadAt" IS NULL OR m."createdAt" > p."lastReadAt")
        GROUP BY p."conversationId"
      ) sub
    `;
    return rows[0]?.count ?? 0;
  }
}
