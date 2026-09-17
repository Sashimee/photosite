import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

export function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

// The gateway hands its Server instance here once (afterInit), so both
// ChatService and the auth module can emit/disconnect without depending on
// the gateway class itself. Lives in its own global module so AuthModule
// (sign-out, session revocation) can inject it without importing ChatModule
// and creating a cycle (ChatModule already imports AuthModule).
@Injectable()
export class ChatSocketBridge {
  private server: Server | undefined;

  setServer(server: Server): void {
    this.server = server;
  }

  // A single publish across every room de-duplicates delivery for a socket
  // that is in more than one of them (its own user room plus a joined
  // conversation room), which two separate `to(room).emit()` calls would not.
  emitToRooms(rooms: readonly string[], event: string, payload: unknown): void {
    this.server?.to([...rooms]).emit(event, payload);
  }

  disconnectUser(userId: string): void {
    this.server?.in(userRoom(userId)).disconnectSockets(true);
  }
}
