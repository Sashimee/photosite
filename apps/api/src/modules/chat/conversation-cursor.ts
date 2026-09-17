import { IdSchema } from '@photoo/shared';
import type { Prisma } from '@photoo/db';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor.js';

const ConversationCursorSchema = z
  .object({ lastMessageAt: z.iso.datetime({ offset: true }).nullable(), id: IdSchema })
  .strict();

export type ConversationCursor = z.infer<typeof ConversationCursorSchema>;

export function decodeConversationCursor(cursor: string): ConversationCursor {
  return decodeCursor(cursor, ConversationCursorSchema);
}

export function encodeConversationCursor(lastMessageAt: Date | null, id: string): string {
  return encodeCursor({ lastMessageAt: lastMessageAt ? lastMessageAt.toISOString() : null, id });
}

// Conversations sort by lastMessageAt desc with nulls last (a freshly
// created quote conversation has no messages yet), so the keyset condition
// has to cover both a numeric cursor and the "now in the trailing null
// block" cursor separately.
export function conversationCursorWhere(cursor: ConversationCursor): Prisma.ConversationWhereInput {
  if (cursor.lastMessageAt === null) {
    return { lastMessageAt: null, id: { gt: cursor.id } };
  }
  const at = new Date(cursor.lastMessageAt);
  return {
    OR: [
      { lastMessageAt: { lt: at } },
      { lastMessageAt: at, id: { gt: cursor.id } },
      { lastMessageAt: null },
    ],
  };
}
