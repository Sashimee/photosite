import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OriginGuard } from '../auth/origin-guard.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminBookingsController } from './admin-bookings.controller.js';
import { AdminBookingsService } from './admin-bookings.service.js';
import { BookingMoneyEventsService } from './booking-money-events.service.js';
import { BookingMoneyLockService } from './booking-money-lock.service.js';
import { BookingPaymentsController } from './booking-payments.controller.js';
import { BookingPaymentsService } from './booking-payments.service.js';
import { BookingRefundService } from './booking-refund.service.js';
import { BookingReleaseQueueService } from './booking-release-queue.service.js';
import { BookingReleaseService } from './booking-release.service.js';
import { MyStripeController } from './my-stripe.controller.js';
import { PaymentsRateLimitService } from './payments-rate-limit.service.js';
import { StripeConnectService } from './stripe-connect.service.js';
import { StripeEventSweepService } from './stripe-event-sweep.service.js';
import { StripeWebhookController } from './stripe-webhook.controller.js';
import { StripeWebhookService } from './stripe-webhook.service.js';
import { stripeGatewayProvider } from './stripe/stripe-gateway.provider.js';

@Module({
  imports: [AuthModule, AdminModule, NotificationsModule],
  controllers: [
    MyStripeController,
    BookingPaymentsController,
    AdminBookingsController,
    StripeWebhookController,
  ],
  providers: [
    StripeConnectService,
    BookingPaymentsService,
    BookingReleaseService,
    BookingReleaseQueueService,
    BookingRefundService,
    BookingMoneyEventsService,
    BookingMoneyLockService,
    AdminBookingsService,
    StripeWebhookService,
    StripeEventSweepService,
    PaymentsRateLimitService,
    stripeGatewayProvider,
    OriginGuard,
  ],
  exports: [StripeConnectService, BookingReleaseService],
})
export class PaymentsModule {}
