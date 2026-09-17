import { HttpException, Inject } from '@nestjs/common';
import {
  Ack,
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import {
  CLIENT_SOCKET_EVENTS,
  ClientConversationJoinEventSchema,
  ClientMessageSendEventSchema,
  ClientReadEventSchema,
  ClientTypingEventSchema,
  SERVER_SOCKET_EVENTS,
  SocketHandshakeAuthSchema,
  type SocketAck,
  type SocketAckError,
} from '@photoo/shared';
import { Logger } from 'nestjs-pino';
import type { Server, Socket } from 'socket.io';
import { APP_CONFIG, type Env } from '../../config/env.js';
import { AUTH_INSTANCE } from '../auth/auth-instance.provider.js';
import type { Auth } from '../auth/auth-instance.js';
import type { BetterAuthSessionRow, BetterAuthUserRow } from '../auth/session.js';
import { CHAT_CLOCK, type ChatClock } from './chat-clock.js';
import { ChatPresenceService } from './chat-presence.service.js';
import { ChatSessionCache } from './chat-session-cache.js';
import { ChatSocketBridge, conversationRoom, userRoom } from './chat-socket-bridge.js';
import { ChatService } from './chat.service.js';

const TYPING_THROTTLE_MS = 2000;
const MAX_SOCKETS_PER_USER = 10;
const MAX_HTTP_BUFFER_SIZE = 64 * 1024;
const HEARTBEAT_INTERVAL_MS = 20_000;
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const EVENTS_PER_SECOND = 20;
const RATE_WINDOW_MS = 1000;
const MAX_RATE_VIOLATIONS = 5;

interface SocketData {
  userId: string;
  sessionId: string;
  expiresAtMs: number;
}

interface AuthenticatedSocket extends Socket {
  data: SocketData;
}

interface EventRateState {
  windowStart: number;
  count: number;
  violations: number;
}

function toAckError(error: unknown): SocketAckError {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object') {
      const body = response as { code?: unknown; message?: unknown };
      return {
        code: typeof body.code === 'string' ? body.code : 'ERROR',
        message: typeof body.message === 'string' ? body.message : error.message,
      };
    }
    return { code: 'ERROR', message: error.message };
  }
  return { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong' };
}

function badRequestAck(): SocketAckError {
  return { code: 'BAD_REQUEST', message: 'Invalid payload' };
}

function notFoundAck(): SocketAckError {
  return { code: 'NOT_FOUND', message: 'Conversation not found' };
}

function unauthorizedAck(): SocketAckError {
  return { code: 'UNAUTHORIZED', message: 'Session is no longer valid' };
}

function buildHandshakeHeaders(client: Socket): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(client.handshake.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
    } else {
      headers.set(key, value);
    }
  }
  const auth = SocketHandshakeAuthSchema.safeParse(client.handshake.auth);
  if (auth.success && auth.data.token) {
    headers.set('authorization', `Bearer ${auth.data.token}`);
  }
  return headers;
}

function expiresAtMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

// The origin/allow-list check duplicates OriginGuard's rule (D21) rather
// than reusing it directly: OriginGuard is a Nest HTTP guard bound to
// Fastify's request/response, and the handshake here is a raw
// http.IncomingMessage with no reply to send a rejection through.
@WebSocketGateway({
  path: '/v1/socket.io',
  maxHttpBufferSize: MAX_HTTP_BUFFER_SIZE,
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server!: Server;

  private readonly lastTypingAt = new Map<string, number>();
  private readonly eventRates = new Map<string, EventRateState>();
  private readonly heartbeats = new Map<string, ReturnType<typeof setInterval>>();
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Inject(AUTH_INSTANCE) private readonly auth: Auth,
    @Inject(APP_CONFIG) private readonly config: Env,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(ChatSocketBridge) private readonly bridge: ChatSocketBridge,
    @Inject(ChatPresenceService) private readonly presence: ChatPresenceService,
    @Inject(ChatSessionCache) private readonly sessionCache: ChatSessionCache,
    @Inject(CHAT_CLOCK) private readonly now: ChatClock,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  afterInit(server: Server): void {
    this.bridge.setServer(server);
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => {
          next();
        },
        (error: unknown) => {
          next(error instanceof Error ? error : new Error('unauthorized'));
        },
      );
    });
  }

  private async authenticate(socket: Socket): Promise<void> {
    const secFetchSite = socket.handshake.headers['sec-fetch-site'];
    if (secFetchSite === 'cross-site') {
      throw new Error('cross-site request rejected');
    }

    const authPayload = SocketHandshakeAuthSchema.safeParse(socket.handshake.auth);
    const bearerToken = authPayload.success ? authPayload.data.token : undefined;
    const origin = socket.handshake.headers.origin;

    if (bearerToken) {
      if (origin && !this.config.WEB_ORIGINS.includes(origin)) {
        throw new Error('origin not allowed');
      }
    } else if (!origin || !this.config.WEB_ORIGINS.includes(origin)) {
      throw new Error('origin not allowed');
    }

    const session = await this.auth.api.getSession({ headers: buildHandshakeHeaders(socket) });
    if (!session) {
      throw new Error('unauthorized');
    }
    const user = session.user as unknown as BetterAuthUserRow;
    const sessionRow = session.session as unknown as BetterAuthSessionRow;

    const admitted = await this.presence.tryJoin(user.id, socket.id, MAX_SOCKETS_PER_USER);
    if (!admitted) {
      throw new Error('too many connections');
    }

    (socket as AuthenticatedSocket).data = {
      userId: user.id,
      sessionId: sessionRow.id,
      expiresAtMs: expiresAtMs(sessionRow.expiresAt),
    };
  }

  handleConnection(client: AuthenticatedSocket): void {
    void client.join(userRoom(client.data.userId));

    this.heartbeats.set(
      client.id,
      setInterval(() => {
        void this.presence.heartbeat(client.data.userId, client.id);
      }, HEARTBEAT_INTERVAL_MS),
    );
    this.scheduleExpiry(client);
  }

  private scheduleExpiry(client: AuthenticatedSocket): void {
    const expiry = client.data.expiresAtMs;
    const delay = Math.min(Math.max(expiry - this.now(), 0), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      if (this.now() >= expiry) {
        client.disconnect(true);
        return;
      }
      this.scheduleExpiry(client);
    }, delay);
    this.expiryTimers.set(client.id, timer);
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.lastTypingAt.delete(client.id);
    this.eventRates.delete(client.id);
    const heartbeat = this.heartbeats.get(client.id);
    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeats.delete(client.id);
    }
    const expiryTimer = this.expiryTimers.get(client.id);
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      this.expiryTimers.delete(client.id);
    }
    void this.presence.leave(client.data.userId, client.id);
  }

  // S1: 20 events/s per socket; repeated overflow disconnects instead of
  // just throttling forever, since a socket ignoring 429-equivalent acks is
  // more likely abuse than a client bug.
  private checkEventRate(client: AuthenticatedSocket): 'ok' | 'throttled' | 'abuse' {
    const now = this.now();
    const state = this.eventRates.get(client.id) ?? { windowStart: now, count: 0, violations: 0 };
    if (now - state.windowStart >= RATE_WINDOW_MS) {
      state.windowStart = now;
      state.count = 0;
    }
    state.count += 1;
    if (state.count > EVENTS_PER_SECOND) {
      state.violations += 1;
      this.eventRates.set(client.id, state);
      return state.violations >= MAX_RATE_VIOLATIONS ? 'abuse' : 'throttled';
    }
    this.eventRates.set(client.id, state);
    return 'ok';
  }

  private async requireValidSession(client: AuthenticatedSocket): Promise<boolean> {
    return this.sessionCache.isValid(client.data.sessionId);
  }

  @SubscribeMessage(CLIENT_SOCKET_EVENTS.CONVERSATION_JOIN)
  async onJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: unknown,
    @Ack() ack: ((response: SocketAck<{ conversation: unknown }>) => void) | undefined,
  ): Promise<void> {
    const rate = this.checkEventRate(client);
    if (rate === 'abuse') {
      client.disconnect(true);
      return;
    }
    if (rate === 'throttled') {
      ack?.({ ok: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Slow down' } });
      return;
    }
    if (!(await this.requireValidSession(client))) {
      ack?.({ ok: false, error: unauthorizedAck() });
      client.disconnect(true);
      return;
    }
    const parsed = ClientConversationJoinEventSchema.safeParse(body);
    if (!parsed.success) {
      ack?.({ ok: false, error: badRequestAck() });
      return;
    }
    try {
      const isMember = await this.chat.isParticipant(
        parsed.data.conversationId,
        client.data.userId,
      );
      if (!isMember) {
        ack?.({ ok: false, error: notFoundAck() });
        return;
      }
      await client.join(conversationRoom(parsed.data.conversationId));
      const conversation = await this.chat.get(
        { id: client.data.userId },
        parsed.data.conversationId,
      );
      ack?.({ ok: true, data: { conversation } });
    } catch (error) {
      this.logUnexpected(error, client, 'conversation:join');
      ack?.({ ok: false, error: toAckError(error) });
    }
  }

  @SubscribeMessage(CLIENT_SOCKET_EVENTS.MESSAGE_SEND)
  async onMessageSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: unknown,
    @Ack() ack: ((response: SocketAck<{ message: unknown }>) => void) | undefined,
  ): Promise<void> {
    const rate = this.checkEventRate(client);
    if (rate === 'abuse') {
      client.disconnect(true);
      return;
    }
    if (rate === 'throttled') {
      ack?.({ ok: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Slow down' } });
      return;
    }
    if (!(await this.requireValidSession(client))) {
      ack?.({ ok: false, error: unauthorizedAck() });
      client.disconnect(true);
      return;
    }
    const parsed = ClientMessageSendEventSchema.safeParse(body);
    if (!parsed.success) {
      ack?.({ ok: false, error: badRequestAck() });
      return;
    }
    try {
      const message = await this.chat.sendMessage(
        { id: client.data.userId },
        parsed.data.conversationId,
        { body: parsed.data.body, attachmentIds: parsed.data.attachmentIds },
      );
      ack?.({ ok: true, data: { message } });
    } catch (error) {
      this.logUnexpected(error, client, 'message:send');
      ack?.({ ok: false, error: toAckError(error) });
    }
  }

  @SubscribeMessage(CLIENT_SOCKET_EVENTS.READ)
  async onRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: unknown,
    @Ack() ack: ((response: SocketAck<{ conversation: unknown }>) => void) | undefined,
  ): Promise<void> {
    const rate = this.checkEventRate(client);
    if (rate === 'abuse') {
      client.disconnect(true);
      return;
    }
    if (rate === 'throttled') {
      ack?.({ ok: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Slow down' } });
      return;
    }
    if (!(await this.requireValidSession(client))) {
      ack?.({ ok: false, error: unauthorizedAck() });
      client.disconnect(true);
      return;
    }
    const parsed = ClientReadEventSchema.safeParse(body);
    if (!parsed.success) {
      ack?.({ ok: false, error: badRequestAck() });
      return;
    }
    try {
      const conversation = await this.chat.markRead(
        { id: client.data.userId },
        parsed.data.conversationId,
        { upToMessageId: parsed.data.upToMessageId },
      );
      ack?.({ ok: true, data: { conversation } });
    } catch (error) {
      this.logUnexpected(error, client, 'read');
      ack?.({ ok: false, error: toAckError(error) });
    }
  }

  @SubscribeMessage(CLIENT_SOCKET_EVENTS.TYPING)
  async onTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: unknown,
    @Ack() ack: ((response: SocketAck<Record<string, never>>) => void) | undefined,
  ): Promise<void> {
    const rate = this.checkEventRate(client);
    if (rate === 'abuse') {
      client.disconnect(true);
      return;
    }
    if (rate === 'throttled') {
      ack?.({ ok: false, error: { code: 'TOO_MANY_REQUESTS', message: 'Slow down' } });
      return;
    }

    const parsed = ClientTypingEventSchema.safeParse(body);
    if (!parsed.success) {
      ack?.({ ok: false, error: badRequestAck() });
      return;
    }

    const throttleKey = `${client.id}:${parsed.data.conversationId}`;
    const isTypingTrue = parsed.data.isTyping;
    const lastAt = this.lastTypingAt.get(throttleKey) ?? 0;
    const now = this.now();
    if (isTypingTrue && now - lastAt < TYPING_THROTTLE_MS) {
      ack?.({ ok: true, data: {} });
      return;
    }
    // The timestamp is set before any await below, so two events arriving
    // back-to-back can't both read a stale `lastAt` and both slip through.
    if (isTypingTrue) {
      this.lastTypingAt.set(throttleKey, now);
    } else {
      this.lastTypingAt.delete(throttleKey);
    }

    if (!(await this.requireValidSession(client))) {
      ack?.({ ok: false, error: unauthorizedAck() });
      client.disconnect(true);
      return;
    }

    const isMember = await this.chat.isParticipant(parsed.data.conversationId, client.data.userId);
    if (!isMember) {
      ack?.({ ok: false, error: notFoundAck() });
      return;
    }

    client.to(conversationRoom(parsed.data.conversationId)).emit(SERVER_SOCKET_EVENTS.TYPING, {
      conversationId: parsed.data.conversationId,
      userId: client.data.userId,
      isTyping: parsed.data.isTyping,
    });
    ack?.({ ok: true, data: {} });
  }

  private logUnexpected(error: unknown, client: AuthenticatedSocket, event: string): void {
    if (error instanceof HttpException) {
      return;
    }
    this.logger.error(
      { err: error, userId: client.data.userId, event },
      'chat: unexpected gateway error',
    );
  }
}
