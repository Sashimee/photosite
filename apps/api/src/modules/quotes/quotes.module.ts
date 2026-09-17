import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { ChatModule } from '../chat/chat.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { quoteEventsProvider } from './quote-events.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesRateLimitService } from './quotes-rate-limit.service.js';
import { QuotesRepository } from './quotes.repository.js';
import { QuotesService } from './quotes.service.js';

@Module({
  imports: [AuthModule, NotificationsModule, ChatModule],
  controllers: [QuotesController],
  providers: [
    QuotesService,
    QuotesRepository,
    QuotesRateLimitService,
    quoteEventsProvider,
    OriginGuard,
  ],
})
export class QuotesModule {}
