import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { quoteEventsProvider } from './quote-events.js';
import { QuotesController } from './quotes.controller.js';
import { QuotesRateLimitService } from './quotes-rate-limit.service.js';
import { QuotesService } from './quotes.service.js';

@Module({
  imports: [AuthModule],
  controllers: [QuotesController],
  providers: [QuotesService, QuotesRateLimitService, quoteEventsProvider, OriginGuard],
})
export class QuotesModule {}
