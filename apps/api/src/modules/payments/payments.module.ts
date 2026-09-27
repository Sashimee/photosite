import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { MyStripeController } from './my-stripe.controller.js';
import { PaymentsRateLimitService } from './payments-rate-limit.service.js';
import { StripeConnectService } from './stripe-connect.service.js';
import { stripeGatewayProvider } from './stripe/stripe-gateway.provider.js';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [MyStripeController],
  providers: [StripeConnectService, PaymentsRateLimitService, stripeGatewayProvider, OriginGuard],
  exports: [StripeConnectService],
})
export class PaymentsModule {}
