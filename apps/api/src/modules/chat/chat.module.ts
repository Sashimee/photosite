import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { chatClockProvider } from './chat-clock.js';
import { ChatMembershipCache } from './chat-membership-cache.js';
import { ChatPresenceService } from './chat-presence.service.js';
import { ChatPushCollapseService } from './chat-push-collapse.service.js';
import { ChatRateLimitService } from './chat-rate-limit.service.js';
import { ChatSessionCache } from './chat-session-cache.js';
import { ChatSocketBridgeModule } from './chat-socket-bridge.module.js';
import { ChatController } from './chat.controller.js';
import { ChatGateway } from './chat.gateway.js';
import { ChatRepository } from './chat.repository.js';
import { ChatService } from './chat.service.js';

@Module({
  imports: [AuthModule, NotificationsModule, ChatSocketBridgeModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatGateway,
    ChatRepository,
    ChatMembershipCache,
    ChatPresenceService,
    ChatRateLimitService,
    ChatPushCollapseService,
    ChatSessionCache,
    chatClockProvider,
    OriginGuard,
  ],
  exports: [ChatService],
})
export class ChatModule {}
